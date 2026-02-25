/**
 * Minimal OAuth 2.1 Authorization Server (RFC 8414 / RFC 7591 / RFC 9728)
 *
 * Implements the authorization code flow with PKCE for Claude.ai connector
 * registration. Uses only Node.js built-in crypto — no external dependencies.
 *
 * Flow:
 *   1. Claude discovers /.well-known/oauth-protected-resource
 *   2. Claude registers itself via POST /oauth/register (DCR)
 *   3. Claude opens browser to GET /oauth/authorize (user enters API key)
 *   4. Server redirects to Claude callback with auth code
 *   5. Claude exchanges code for JWT via POST /oauth/token
 *   6. Claude uses JWT as Bearer token for all MCP requests
 */

import { createHmac, createHash, randomBytes } from "node:crypto";

export type OAuthServerOptions = {
  /** Public base URL of this server, e.g. "https://law-mcp-server-xxx.run.app" */
  issuerUrl: string;
  /** Shared API key — used both to authenticate the authorizing user and to sign tokens */
  apiKey: string;
};

type RegisteredClient = {
  clientId: string;
  clientSecret: string;
  redirectUris: string[];
};

type PendingCode = {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  expiresAt: number;
};

const TOKEN_TTL_SECONDS = 3600; // 1 hour

export class OAuthServer {
  private readonly clients = new Map<string, RegisteredClient>();
  private readonly codes = new Map<string, PendingCode>();

  constructor(private readonly opts: OAuthServerOptions) {}

  get issuerUrl(): string {
    return this.opts.issuerUrl;
  }

  // -------------------------------------------------------------------------
  // Discovery documents
  // -------------------------------------------------------------------------

  /** RFC 9728 — OAuth 2.0 Protected Resource Metadata */
  protectedResourceMetadata(): Record<string, unknown> {
    return {
      resource: `${this.opts.issuerUrl}/mcp`,
      authorization_servers: [this.opts.issuerUrl],
    };
  }

  /** RFC 8414 — OAuth 2.0 Authorization Server Metadata */
  authorizationServerMetadata(): Record<string, unknown> {
    return {
      issuer: this.opts.issuerUrl,
      authorization_endpoint: `${this.opts.issuerUrl}/oauth/authorize`,
      token_endpoint: `${this.opts.issuerUrl}/oauth/token`,
      registration_endpoint: `${this.opts.issuerUrl}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: [
        "client_secret_post",
        "client_secret_basic",
        "none",
      ],
    };
  }

  // -------------------------------------------------------------------------
  // RFC 7591 — Dynamic Client Registration
  // -------------------------------------------------------------------------

  registerClient(body: Record<string, unknown>): Record<string, unknown> {
    const clientId = randomBytes(16).toString("hex");
    const clientSecret = randomBytes(32).toString("hex");
    const redirectUris = Array.isArray(body.redirect_uris)
      ? (body.redirect_uris as string[])
      : [];

    this.clients.set(clientId, { clientId, clientSecret, redirectUris });

    return {
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uris: redirectUris,
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_post",
    };
  }

  // -------------------------------------------------------------------------
  // Authorization endpoint
  // -------------------------------------------------------------------------

  /** Render the HTML authorization page shown to the user in the browser. */
  renderAuthorizePage(
    params: URLSearchParams,
    error?: string
  ): string {
    const fields: Record<string, string> = {
      client_id: params.get("client_id") ?? "",
      redirect_uri: params.get("redirect_uri") ?? "",
      state: params.get("state") ?? "",
      code_challenge: params.get("code_challenge") ?? "",
      code_challenge_method:
        params.get("code_challenge_method") ?? "S256",
      response_type: params.get("response_type") ?? "",
    };

    const errorHtml = error
      ? `<p class="error">${this.esc(error)}</p>`
      : "";

    const hiddenInputs = Object.entries(fields)
      .map(
        ([k, v]) =>
          `<input type="hidden" name="${this.esc(k)}" value="${this.esc(v)}">`
      )
      .join("\n    ");

    return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>law-mcp-server — 接続認証</title>
  <style>
    body{font-family:system-ui,sans-serif;background:#f5f5f5;display:flex;
         align-items:center;justify-content:center;min-height:100vh;margin:0}
    .card{background:#fff;border-radius:8px;padding:32px;max-width:380px;
          width:100%;box-shadow:0 2px 8px rgba(0,0,0,.1)}
    h1{font-size:1.2rem;margin:0 0 8px}
    p{color:#555;font-size:.9rem;margin:0 0 20px}
    .error{color:#c00;font-size:.85rem;margin:-12px 0 12px}
    label{display:block;font-size:.85rem;margin-bottom:4px;color:#333}
    input[type=password]{width:100%;padding:8px 10px;border:1px solid #ccc;
          border-radius:4px;font-size:1rem;box-sizing:border-box}
    button{margin-top:16px;width:100%;padding:10px;background:#5436DA;
           color:#fff;border:none;border-radius:4px;font-size:1rem;cursor:pointer}
    button:hover{background:#4527c1}
  </style>
</head>
<body>
<div class="card">
  <h1>law-mcp-server</h1>
  <p>Claude からの接続を許可するには API キーを入力してください。</p>
  ${errorHtml}
  <form method="POST" action="/oauth/authorize">
    ${hiddenInputs}
    <label for="api_key">API Key</label>
    <input type="password" id="api_key" name="api_key" required autofocus>
    <button type="submit">接続を許可</button>
  </form>
</div>
</body>
</html>`;
  }

  /**
   * Process the submitted authorization form.
   * Returns either a redirect URL (success) or an error message with the
   * original form fields so the page can be re-rendered.
   */
  processAuthorize(
    form: Record<string, string>
  ):
    | { redirect: string }
    | { error: string; fields: Record<string, string> } {
    const {
      api_key,
      client_id,
      redirect_uri,
      state,
      code_challenge,
      code_challenge_method,
    } = form;

    if (api_key !== this.opts.apiKey) {
      return {
        error: "API キーが正しくありません",
        fields: { ...form, api_key: "" },
      };
    }

    const client = this.clients.get(client_id);
    if (!client && !this.isTrustedRedirectUri(redirect_uri)) {
      return {
        error: "クライアントが登録されていません",
        fields: { ...form, api_key: "" },
      };
    }

    const code = randomBytes(32).toString("hex");
    this.codes.set(code, {
      clientId: client_id,
      redirectUri: redirect_uri,
      codeChallenge: code_challenge,
      codeChallengeMethod: code_challenge_method ?? "S256",
      expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
    });

    const url = new URL(redirect_uri);
    url.searchParams.set("code", code);
    if (state) url.searchParams.set("state", state);
    return { redirect: url.toString() };
  }

  // -------------------------------------------------------------------------
  // Token endpoint
  // -------------------------------------------------------------------------

  exchangeToken(
    body: Record<string, string>,
    authorizationHeader: string | undefined
  ): Record<string, unknown> {
    // Support client credentials in Authorization: Basic header or request body
    let clientId = body.client_id ?? "";
    let clientSecret = body.client_secret ?? "";

    if (authorizationHeader?.startsWith("Basic ")) {
      const decoded = Buffer.from(
        authorizationHeader.slice(6),
        "base64"
      ).toString("utf8");
      const sep = decoded.indexOf(":");
      if (sep !== -1) {
        clientId = decoded.slice(0, sep);
        clientSecret = decoded.slice(sep + 1);
      }
    }

    if (body.grant_type !== "authorization_code") {
      return { error: "unsupported_grant_type" };
    }

    const codeEntry = this.codes.get(body.code ?? "");
    if (!codeEntry) return { error: "invalid_grant" };

    if (Date.now() > codeEntry.expiresAt) {
      this.codes.delete(body.code);
      return { error: "invalid_grant" };
    }
    if (codeEntry.redirectUri !== body.redirect_uri) {
      return { error: "invalid_grant" };
    }
    if (codeEntry.clientId !== clientId) {
      return { error: "invalid_grant" };
    }

    // Verify PKCE (required per MCP spec)
    if (
      !this.verifyPkce(
        body.code_verifier ?? "",
        codeEntry.codeChallenge,
        codeEntry.codeChallengeMethod
      )
    ) {
      return { error: "invalid_grant" };
    }

    // Verify client secret if the client was registered with one
    const client = this.clients.get(clientId);
    if (client && clientSecret && client.clientSecret !== clientSecret) {
      return { error: "invalid_client" };
    }

    this.codes.delete(body.code);
    return {
      access_token: this.issueToken(clientId),
      token_type: "Bearer",
      expires_in: TOKEN_TTL_SECONDS,
    };
  }

  // -------------------------------------------------------------------------
  // Token validation (used by the MCP resource server)
  // -------------------------------------------------------------------------

  validateToken(token: string): boolean {
    return this.verifyJwt(token);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private isTrustedRedirectUri(uri: string): boolean {
    return (
      uri.startsWith("https://claude.ai/") ||
      uri.startsWith("http://localhost") ||
      uri.startsWith("http://127.0.0.1")
    );
  }

  private verifyPkce(
    verifier: string,
    challenge: string,
    method: string
  ): boolean {
    if (!verifier || !challenge) return false;
    if (method === "S256") {
      const hash = createHash("sha256")
        .update(verifier)
        .digest("base64url");
      return hash === challenge;
    }
    // "plain" — not recommended but included for compatibility
    return verifier === challenge;
  }

  private issueToken(sub: string): string {
    const now = Math.floor(Date.now() / 1000);
    return this.signJwt({
      iss: this.opts.issuerUrl,
      aud: `${this.opts.issuerUrl}/mcp`,
      sub,
      iat: now,
      exp: now + TOKEN_TTL_SECONDS,
    });
  }

  private signJwt(payload: Record<string, unknown>): string {
    const hdr = Buffer.from(
      JSON.stringify({ alg: "HS256", typ: "JWT" })
    ).toString("base64url");
    const bdy = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const sig = createHmac("sha256", this.opts.apiKey)
      .update(`${hdr}.${bdy}`)
      .digest("base64url");
    return `${hdr}.${bdy}.${sig}`;
  }

  private verifyJwt(token: string): boolean {
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const [hdr, bdy, sig] = parts;

    const expected = createHmac("sha256", this.opts.apiKey)
      .update(`${hdr}.${bdy}`)
      .digest("base64url");
    if (sig !== expected) return false;

    try {
      const payload = JSON.parse(
        Buffer.from(bdy, "base64url").toString("utf8")
      ) as Record<string, unknown>;
      const now = Math.floor(Date.now() / 1000);
      if (typeof payload.exp === "number" && payload.exp < now) return false;
      if (payload.aud !== `${this.opts.issuerUrl}/mcp`) return false;
      return true;
    } catch {
      return false;
    }
  }

  private esc(s: string): string {
    return s
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
}
