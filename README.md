# Law MCP Server Specification

This repository will host an MCP server that uses **法令API Version 2** (e-Gov) to fetch statute data and help check the consistency between internal documents and the referenced laws. The document below captures the target capabilities and operational expectations before implementation.

## Overview

- Provide MCP tools that surface law data from the official API and perform document-to-law consistency checks.
- Enable knowledge workers to verify whether policy drafts, contracts, or memos align with authoritative legal text.
- Favor transparent outputs that include sources (LawID, article numbers, URLs) and the reasoning steps used during checks.

## External Data Source

- Base: `https://laws.e-gov.go.jp/api/2/`
- Common endpoints (see [swagger](https://laws.e-gov.go.jp/api/2/swagger-ui) for full schema):
  - `GET /law_data/{law_id_or_num_or_revision_id}` – fetch law structure and articles.
  - `GET /keyword?keyword={keyword}` – search laws by keyword.
  - `GET /laws?law_title={title}` – search laws by title.
- Response format: JSON (includes meta, LawName, Articles, etc.). Respect official rate limits; treat 429/503 as retryable with backoff.

## MCP Capabilities

- `search_laws` – Input: `keyword` (string). Output: list of LawID, title, and promulgation date.
- `fetch_law` – Input: `lawId` (string), optional `revisionDate`. Output: normalized law JSON.
- `check_consistency` – Input: `documentText`, `lawIds` (required). Output: matched citations, conflicting passages, and similarity scores.
- `summarize_law` – Input: `lawId`, optional `articles` list. Output: concise article summary with paragraph text.

## Consistency Check Workflow

- Normalize the incoming document (segment by sentence/section, detect cited articles like “第○条”).
- Resolve target laws: use `lawIds` provided or run `search_laws` to suggest candidates.
- Fetch required law texts via `fetch_law`; cache responses per `LawID` to reduce API load.
- Align document segments to law articles using string similarity and citation hints; note exact article numbers when present.
- Produce findings: for each segment, mark status (`aligned`, `potential_mismatch`, `not_found`), include article references, and show snippets from both sides.
- Provide remediation suggestions (e.g., cite correct article, adjust wording) without altering the source document automatically.

## Server Behavior & Error Handling

- Map API errors to MCP-friendly errors with actionable messages (e.g., missing `LawID`, upstream 429, malformed parameters).
- Use exponential backoff on 429/503 and surface retry-after hints when present.
- Validate inputs early: reject empty `documentText`, overly long queries, or unsupported `lawId` formats with clear guidance.
- Log tool calls and upstream URLs for debugging; avoid storing document contents longer than the session.

## Configuration

- Environment variables:
  - `LAW_API_BASE` (default `https://laws.e-gov.go.jp/api/2/`)
  - `HTTP_TIMEOUT_MS` (default 15000)
  - `CACHE_TTL_SECONDS` (default 900)
  - `TRANSPORT` (`stdio` | `sse` | `http`, default `stdio`)
  - `PORT` (default 3000; Cloud Run provides `PORT=8080`)
  - `API_KEY` (required when `TRANSPORT=sse` or `TRANSPORT=http`; unused for stdio)
  - `ISSUER_URL` (required for OAuth / Claude.ai connector; e.g. `https://law-mcp-server-xxx.run.app`)
  - `ALLOWED_ORIGIN` (optional CORS allowlist for HTTP/SSE transport)
- `.env` is `.gitignore` されているので secrets はコミットしないこと。

## Implementation Notes

- Suggested stack: Node.js with a lightweight stdio JSON-RPC bridge for MCP compatibility, `undici`/`node-fetch` for HTTP, and a lightweight in-memory cache (Map/LRU). TypeScript preferred for schema safety using the Swagger spec.
- Define TypeScript types for API responses (LawData, Article, SearchResult) to enforce strict parsing.
- Keep business logic pure and testable (e.g., citation extraction, alignment scoring) independent of I/O.
- Expose a health endpoint or MCP tool (e.g., `ping`) for quick readiness checks.

## Getting Started

- Requirements: Node.js 18+.
- Install dependencies: `npm install`.
- Build: `npm run build`.
- Copy `.env.example` to `.env` and adjust if needed.
- Run server over stdio (JSON-RPC): `npm start` (or `npm run dev` for ts-node).
- Configure via environment variables in `.env` (see Configuration section). The server registers tools `search_laws`, `fetch_law`, `check_consistency`, and `summarize_law`.
- Quality: `npm run lint` (ESLint) / `npm run format` (Prettier).

## Transport Modes

### stdio (local default)

- `TRANSPORT=stdio` (default). Authなしでローカル利用。
- `npm start` もしくは `npm run dev` で起動。

### Streamable HTTP / http (Cloud Run 向け・推奨)

MCP 仕様 2025-06-18 準拠の Streamable HTTP transport。Claude.ai のコネクタ登録に対応。

- `TRANSPORT=http` と `API_KEY` を設定し、`PORT` に Cloud Run のポート（通常 8080）を渡す。
- 認証: `Authorization: Bearer <API_KEY>` または `x-api-key: <API_KEY>`。
- エンドポイント:
  - `POST /mcp` — JSON-RPC リクエスト送信（メインエンドポイント）
  - `GET /mcp` — サーバー起点の SSE ストリーム（サーバー通知用）
  - `DELETE /mcp` — セッション終了
  - `GET /health` — ヘルスチェック
- セッション管理: `Mcp-Session-Id` レスポンスヘッダーで返却、以降のリクエストでヘッダーに付与。

動作確認例:
```bash
# 1. initialize（セッション作成）
curl -s -D - -X POST \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","clientInfo":{"name":"test","version":"1.0"}}}' \
  https://<host>/mcp
# → Mcp-Session-Id: <session-id> がレスポンスヘッダーに返る

# 2. tools/list（セッションIDを使用）
curl -s -X POST \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -H "Mcp-Session-Id: <session-id>" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  https://<host>/mcp
```

### Claude.ai コネクタ登録

Claude.ai の「コネクタ」機能から直接登録できます（`TRANSPORT=http` + `ISSUER_URL` 設定時）。

#### 初回デプロイ手順

1. Cloud Run に一度デプロイし、サービス URL（`https://law-mcp-server-xxx.run.app`）を確認。
2. GitHub Secrets に `ISSUER_URL` を追加（値: 確認したサービス URL）。
3. 再デプロイ（`ISSUER_URL` が環境変数に反映される）。

#### Claude.ai での登録手順

1. Claude.ai の設定 → **「コネクタ」** → **「カスタムコネクタを追加」**
2. MCP サーバー URL を入力: `https://<host>/mcp`
3. 「接続」をクリック → ブラウザが開き API キー入力画面が表示される
4. デプロイ時に設定した `API_KEY` を入力して「接続を許可」

> **「詳細設定」で OAuth Client ID / Secret を手動指定する場合**
> Dynamic Client Registration（DCR）を使わずに固定クレデンシャルを使いたい場合は、
> 事前に `POST /oauth/register` を呼び出してクライアントを登録し、
> 返却された `client_id` / `client_secret` を Claude.ai に入力してください。

### SSE (旧仕様、後方互換)

- `TRANSPORT=sse` で旧 SSE transport を使用（Claude Desktop + mcp-remote 向け）。
- エンドポイント: `GET /events` (SSE ストリーム), `POST /messages` (JSON-RPC リクエスト)。

### Claude Desktop configuration

- **Local (stdio transport)**
  - Install globally: `npm install -g law-mcp-server`.
  - `claude_desktop_config.json`:

  ```json
  {
    "mcpServers": {
      "law-mcp-server": {
        "command": "law-mcp-server"
      }
    }
  }
  ```

  If you are installing from a local clone instead of the published
  package, run `npm install && npm run build` and then `npm link` so the
  `law-mcp-server` command is available on your `PATH` for Claude Desktop.

- **Cloud Run (Streamable HTTP transport)**
  - Ensure Cloud Run is deployed with `TRANSPORT=http` and `API_KEY` set.
  - Use [mcp-remote](https://www.npmjs.com/package/mcp-remote) as a local stdio-to-HTTP bridge.
  - Install mcp-remote: `npm install -g mcp-remote`
  - In `claude_desktop_config.json`:

  ```json
  {
    "mcpServers": {
      "law-mcp-server": {
        "command": "mcp-remote",
        "args": [
          "https://law-mcp-server-<hash>.asia-northeast1.run.app/mcp",
          "--header",
          "Authorization: Bearer <API_KEY>"
        ]
      }
    }
  }
  ```

  - Replace `<hash>` with your Cloud Run service suffix and `<API_KEY>` with the same key set on Cloud Run.

## Usage Examples (conceptual)

- Search and fetch: “Search for 個人情報保護 and show the latest articles.” → calls `search_laws` then `fetch_law`.
- Consistency check: "Check this draft against 労働基準法 Articles 24 and 37; highlight mismatches." → calls `search_laws` to get LawID, then `check_consistency` with `lawIds=[...]`.

## Skills

This repository includes domain-specific skills that demonstrate effective usage patterns for law-mcp-server tools. Skills provide comprehensive guides on how to leverage the server's capabilities for specific use cases.

### Available Skills

#### Digital Marketing Law Skill (`skills/digital-marketing-law/`)

A comprehensive guide for using law-mcp-server to reference and verify compliance with laws related to digital marketing activities in Japan. This skill covers:

- **Display Regulations**: Misleading Representation Prevention Act (景品表示法), Specified Commercial Transactions Act (特商法), Consumer Contract Act
- **Personal Information & Tracking**: Personal Information Protection Act (個人情報保護法), Telecommunications Business Act (電気通信事業法), Specified Electronic Mail Act
- **Platform Regulations**: Digital Platform Transparency Act, Provider Liability Act
- **Industry-Specific Laws**: Pharmaceutical Affairs Act (薬機法), Financial Instruments and Exchange Act (金商法)
- **Intellectual Property**: Copyright Act, Trademark Act, Unfair Competition Prevention Act
- **Competition Law**: Antimonopoly Act (独占禁止法)

**Key Features**:

- Search patterns for formal names, abbreviations, and article numbers
- 5 practical workflows (privacy policy creation, ad review, email marketing, platform transactions, amendment tracking)
- Real-world use cases for JIAA/APTI activities, client proposals, and compliance checks
- Common Q&A (Cookie consent, influencer marketing, comparative advertising, AI-generated content, retargeting)

**Usage**:

1. Read the skill file: `skills/digital-marketing-law/digital-marketing-law-SKILL.md`
2. Reference the appropriate workflow for your task
3. Use the provided search keywords and tool sequences
4. Follow the best practices for law searches and consistency checks

### Using Skills with Claude

To enable Claude to use these skills effectively:

1. **With Claude Desktop**: Skills in this repository are automatically available when the law-mcp-server is configured
2. **With Claude API**: Include the skill content in your system prompts or as reference documentation
3. **Custom Integration**: Point Claude to the skills directory in your MCP server configuration

Skills enhance Claude's ability to:

- Choose the right tools for specific legal queries
- Use appropriate search keywords (formal names vs. abbreviations)
- Apply domain knowledge for effective law searches
- Structure multi-step legal compliance checks
- Provide context-aware recommendations

## Cloud Run Deployment

- Container image is built via `Dockerfile` (default `TRANSPORT=sse`, `PORT=8080`).
- GitHub Actions workflow: `.github/workflows/deploy.yml` deploys on `push` to `main`.
- Required GitHub Secrets: `GCP_PROJECT_ID`, `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_SERVICE_ACCOUNT`, `API_KEY` (used as HTTP auth key).
- Artifact Registry target: `asia-northeast1-docker.pkg.dev/<PROJECT_ID>/law-mcp-server/law-mcp-server` (PROJECT_ID is the dedicated project).
- Cloud Run settings in the workflow: `min-instances=1`, `concurrency=10`, env vars `TRANSPORT=sse`, `API_KEY`（`PORT`は Cloud Run が自動設定）。
- `.env` is ignored by git; keep secrets local and do not commit them.

## Validation Plan (to implement)

- Unit tests for citation parsing, article alignment scoring, and API response normalization.
- Integration tests mocking the 法令API to cover success, 404, 429/503 retry, and malformed LawID cases.
- Integration test runner: `npm run test` (uses undici MockAgent; no network).
- Manual smoke: run MCP client (e.g., Claude Desktop) to issue `search_laws` and `check_consistency` commands.

---

This specification is the starting point; refine it as implementation details solidify while keeping parity with the official 法令API Version 2 documentation.
