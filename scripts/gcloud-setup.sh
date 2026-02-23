#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   PROJECT_ID="my-law-mcp" GITHUB_REPO="owner/repo" ./scripts/gcloud-setup.sh
# After this script, link a billing account to the project, then set GitHub
# Secrets (GCP_PROJECT_ID, GCP_WORKLOAD_IDENTITY_PROVIDER, GCP_SERVICE_ACCOUNT, API_KEY).

: "${PROJECT_ID:?PROJECT_ID is required (e.g., my-law-mcp)}"
: "${GITHUB_REPO:?GITHUB_REPO is required (e.g., myorg/myrepo)}"

REGION=${REGION:-asia-northeast1}
REPO=${REPO:-law-mcp-server}
SERVICE_NAME=${SERVICE_NAME:-law-mcp-server}
SERVICE_ACCOUNT_NAME=${SERVICE_ACCOUNT_NAME:-law-mcp-server-deployer}
WIP_NAME=${WIP_NAME:-github-pool}
WIP_PROVIDER=${WIP_PROVIDER:-github-provider}

SA_EMAIL="${SERVICE_ACCOUNT_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

echo "[1/8] Create project (if not existing)"
gcloud projects describe "$PROJECT_ID" >/dev/null 2>&1 || \
  gcloud projects create "$PROJECT_ID" --name="$PROJECT_ID"

echo "[2/8] Set default project"
gcloud config set project "$PROJECT_ID"

echo "[3/8] Enable required APIs"
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  iamcredentials.googleapis.com \
  sts.googleapis.com

echo "[4/8] Create Artifact Registry repo (Docker)"
gcloud artifacts repositories describe "$REPO" --location="$REGION" >/dev/null 2>&1 || \
  gcloud artifacts repositories create "$REPO" \
    --repository-format=docker \
    --location="$REGION" \
    --description="law-mcp-server images"

echo "[5/8] Create service account"
gcloud iam service-accounts describe "$SA_EMAIL" >/dev/null 2>&1 || \
  gcloud iam service-accounts create "$SERVICE_ACCOUNT_NAME" \
    --display-name="Law MCP Server Deployer"

echo "[6/8] Grant roles to service account"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/run.admin"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/artifactregistry.writer"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/cloudbuild.builds.editor"

# Allow deployer to set the runtime service account (default compute SA)
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)")
RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/iam.serviceAccountUser"

echo "[7/8] Configure Workload Identity Pool & Provider (for GitHub Actions)"
gcloud iam workload-identity-pools describe "$WIP_NAME" --location=global >/dev/null 2>&1 || \
  gcloud iam workload-identity-pools create "$WIP_NAME" \
    --location=global \
    --display-name="GitHub Actions Pool"

WIP_RESOURCE_NAME=$(gcloud iam workload-identity-pools describe "$WIP_NAME" --location=global --format="value(name)")

gcloud iam workload-identity-pools providers describe "$WIP_PROVIDER" \
  --location=global \
  --workload-identity-pool="$WIP_NAME" >/dev/null 2>&1 || \
  gcloud iam workload-identity-pools providers create-oidc "$WIP_PROVIDER" \
    --location=global \
    --workload-identity-pool="$WIP_NAME" \
    --display-name="GitHub OIDC" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository" \
    --attribute-condition="attribute.repository=='$GITHUB_REPO'"

echo "[8/8] Allow GitHub principal to impersonate deployer SA"
gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/${WIP_RESOURCE_NAME}/attribute.repository/${GITHUB_REPO}"

cat <<EOF
Done.
Next steps:
1) Link billing account to project: gcloud beta billing projects link $PROJECT_ID --billing-account <ACCOUNT_ID>
2) In GitHub repo secrets, set:
   - GCP_PROJECT_ID=$PROJECT_ID
   - GCP_WORKLOAD_IDENTITY_PROVIDER=${WIP_RESOURCE_NAME}/providers/${WIP_PROVIDER}
   - GCP_SERVICE_ACCOUNT=$SA_EMAIL
   - API_KEY=<your-api-key>
3) Deploy via GitHub Actions (push to main) or run locally:
   gcloud builds submit --tag asia-northeast1-docker.pkg.dev/$PROJECT_ID/$REPO/$SERVICE_NAME .
   gcloud run deploy $SERVICE_NAME --image asia-northeast1-docker.pkg.dev/$PROJECT_ID/$REPO/$SERVICE_NAME --region $REGION --platform managed --min-instances=1 --concurrency=10 --set-env-vars=TRANSPORT=sse,PORT=8080,API_KEY=... --allow-unauthenticated
EOF
