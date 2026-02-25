import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { JsonRpcRequest, JsonRpcRouter } from "./rpc.js";
import { OAuthServer } from "./oauth.js";

export type StreamableHttpOptions = {
  port: number;
  apiKey: string;
  allowedOrigin?: string;
  /** When provided, OAuth 2.1 endpoints are mounted and tokens are validated as JWTs. */
  oauth?: OAuthServer;
};

type Session = {
  id: string;
  sseResponse?: ServerResponse;
};

const AUTH_HEADER = "authorization";
const API_KEY_HEADER = "x-api-key";
const SESSION_HEADER = "mcp-session-id";

const extractToken = (req: IncomingMessage): string | null => {
  const authHeader = req.headers[AUTH_HEADER];
  const apiKeyHeader = req.headers[API_KEY_HEADER];

  if (typeof authHeader === "string") {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match) return match[1].trim();
  }

  if (typeof apiKeyHeader === "string") return apiKeyHeader.trim();
  if (Array.isArray(apiKeyHeader) && apiKeyHeader.length > 0)
    return apiKeyHeader[0]?.trim() ?? null;

  return null;
};

export class StreamableHttpServer {
  private sessions = new Map<string, Session>();

  constructor(
    private readonly router: JsonRpcRouter,
    private readonly options: StreamableHttpOptions
  ) {}

  start() {
    const server = createServer(async (req, res) => {
      if (req.method === "OPTIONS") {
        this.handleCors(res);
        return;
      }

      if (req.method === "GET" && req.url === "/health") {
        this.writeJson(res, 200, { status: "ok" });
        return;
      }

      // OAuth discovery and flow endpoints — no Bearer token required
      if (this.options.oauth) {
        const handled = await this.handleOAuth(req, res, this.options.oauth);
        if (handled) return;
      }

      // All other endpoints require authentication
      if (!this.isAuthorized(req)) {
        this.sendUnauthorized(res);
        return;
      }

      const url = req.url ?? "";
      const isMcpEndpoint = url === "/mcp" || url.startsWith("/mcp?");

      if (isMcpEndpoint) {
        if (req.method === "POST") {
          await this.handlePost(req, res);
          return;
        }
        if (req.method === "GET") {
          this.handleGet(req, res);
          return;
        }
        if (req.method === "DELETE") {
          this.handleDelete(req, res);
          return;
        }
      }

      this.writeJson(res, 404, { error: "Not Found" });
    });

    server.listen(this.options.port, () => {
      console.log(
        `Streamable HTTP server listening on port ${this.options.port}`
      );
    });
  }

  // ---------------------------------------------------------------------------
  // OAuth 2.1 endpoint handler
  // Returns true if the request was handled (so the caller can return early).
  // ---------------------------------------------------------------------------

  private async handleOAuth(
    req: IncomingMessage,
    res: ServerResponse,
    oauth: OAuthServer
  ): Promise<boolean> {
    const url = req.url ?? "";

    // RFC 9728 — Protected Resource Metadata
    if (
      req.method === "GET" &&
      url === "/.well-known/oauth-protected-resource"
    ) {
      this.writeJson(res, 200, oauth.protectedResourceMetadata());
      return true;
    }

    // RFC 8414 — Authorization Server Metadata
    if (
      req.method === "GET" &&
      url === "/.well-known/oauth-authorization-server"
    ) {
      this.writeJson(res, 200, oauth.authorizationServerMetadata());
      return true;
    }

    // RFC 7591 — Dynamic Client Registration
    if (req.method === "POST" && url === "/oauth/register") {
      const body = await this.readBody(req);
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(body) as Record<string, unknown>;
      } catch {
        this.writeJson(res, 400, { error: "invalid_request" });
        return true;
      }
      const client = oauth.registerClient(parsed);
      this.writeJson(res, 201, client);
      return true;
    }

    // Authorization endpoint — GET: show form, POST: process form
    if (url === "/oauth/authorize" || url.startsWith("/oauth/authorize?")) {
      if (req.method === "GET") {
        const params = new URL(url, "http://localhost").searchParams;
        const html = oauth.renderAuthorizePage(params);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
        return true;
      }

      if (req.method === "POST") {
        const body = await this.readBody(req);
        const form = Object.fromEntries(new URLSearchParams(body).entries());
        const result = oauth.processAuthorize(form);

        if ("redirect" in result) {
          res.writeHead(302, { Location: result.redirect });
          res.end();
        } else {
          // Re-render form with error
          const params = new URLSearchParams(result.fields);
          const html = oauth.renderAuthorizePage(params, result.error);
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(html);
        }
        return true;
      }
    }

    // Token endpoint
    if (req.method === "POST" && url === "/oauth/token") {
      const body = await this.readBody(req);
      const form = Object.fromEntries(new URLSearchParams(body).entries());
      const authHeader = req.headers[AUTH_HEADER] as string | undefined;
      const tokenResponse = oauth.exchangeToken(form, authHeader);

      const status = "error" in tokenResponse ? 400 : 200;
      this.writeJson(res, status, tokenResponse);
      return true;
    }

    return false;
  }

  // ---------------------------------------------------------------------------
  // MCP Streamable HTTP endpoints
  // ---------------------------------------------------------------------------

  private async handlePost(req: IncomingMessage, res: ServerResponse) {
    const body = await this.readBody(req);
    const message = this.parseMessage(body);
    if (!message) {
      this.writeJson(res, 400, { error: "Invalid JSON-RPC request" });
      return;
    }

    const sessionId = req.headers[SESSION_HEADER] as string | undefined;
    let session: Session;

    if (message.method === "initialize") {
      // initialize always creates a new session
      const newId = randomUUID();
      session = { id: newId };
      this.sessions.set(newId, session);
    } else {
      if (!sessionId) {
        this.writeJson(res, 400, {
          error: `${SESSION_HEADER} header is required`,
        });
        return;
      }
      const existing = this.sessions.get(sessionId);
      if (!existing) {
        this.writeJson(res, 404, { error: "Session not found" });
        return;
      }
      session = existing;
    }

    const response = await this.router.handle(message);

    // Notifications (no id) → 202 Accepted, no body
    if (response === null) {
      res.writeHead(202, this.baseHeaders(session.id));
      res.end();
      return;
    }

    const acceptHeader = req.headers["accept"] ?? "";
    const prefersSse = acceptHeader.includes("text/event-stream");

    if (prefersSse) {
      res.writeHead(200, {
        ...this.baseHeaders(session.id),
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(`event: message\ndata: ${JSON.stringify(response)}\n\n`);
      res.end();
    } else {
      res.writeHead(200, {
        ...this.baseHeaders(session.id),
        "Content-Type": "application/json",
      });
      res.end(JSON.stringify(response));
    }
  }

  // GET /mcp — SSE stream for server-initiated messages
  private handleGet(req: IncomingMessage, res: ServerResponse) {
    const sessionId = req.headers[SESSION_HEADER] as string | undefined;
    if (!sessionId) {
      this.writeJson(res, 400, {
        error: `${SESSION_HEADER} header is required`,
      });
      return;
    }
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.writeJson(res, 404, { error: "Session not found" });
      return;
    }

    res.writeHead(200, {
      ...this.baseHeaders(session.id),
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    session.sseResponse = res;
    res.on("close", () => {
      if (session.sseResponse === res) {
        session.sseResponse = undefined;
      }
    });
  }

  // DELETE /mcp — terminate session
  private handleDelete(req: IncomingMessage, res: ServerResponse) {
    const sessionId = req.headers[SESSION_HEADER] as string | undefined;
    if (!sessionId) {
      this.writeJson(res, 400, {
        error: `${SESSION_HEADER} header is required`,
      });
      return;
    }
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.writeJson(res, 404, { error: "Session not found" });
      return;
    }

    if (session.sseResponse) {
      session.sseResponse.end();
    }
    this.sessions.delete(sessionId);

    res.writeHead(200, {
      "Access-Control-Allow-Origin": this.options.allowedOrigin || "*",
    });
    res.end();
  }

  // ---------------------------------------------------------------------------
  // Auth helpers
  // ---------------------------------------------------------------------------

  private isAuthorized(req: IncomingMessage): boolean {
    const token = extractToken(req);
    if (!token) return false;
    if (this.options.oauth) {
      return this.options.oauth.validateToken(token);
    }
    return token === this.options.apiKey;
  }

  private sendUnauthorized(res: ServerResponse) {
    if (this.options.oauth) {
      res.setHeader(
        "WWW-Authenticate",
        `Bearer resource_metadata="${this.options.oauth.issuerUrl}/.well-known/oauth-protected-resource"`
      );
    }
    this.writeJson(res, 401, { error: "Unauthorized" });
  }

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  private handleCors(res: ServerResponse) {
    res.statusCode = 204;
    res.setHeader(
      "Access-Control-Allow-Origin",
      this.options.allowedOrigin || "*"
    );
    res.setHeader(
      "Access-Control-Allow-Headers",
      `Content-Type, Authorization, ${API_KEY_HEADER}, ${SESSION_HEADER}`
    );
    res.setHeader("Access-Control-Expose-Headers", SESSION_HEADER);
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
    res.end();
  }

  private baseHeaders(sessionId: string): Record<string, string> {
    return {
      "Mcp-Session-Id": sessionId,
      "Access-Control-Allow-Origin": this.options.allowedOrigin || "*",
      "Access-Control-Expose-Headers": SESSION_HEADER,
    };
  }

  private parseMessage(body: string): JsonRpcRequest | null {
    try {
      const parsed = JSON.parse(body) as JsonRpcRequest;
      if (
        !parsed ||
        parsed.jsonrpc !== "2.0" ||
        typeof parsed.method !== "string"
      ) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  private async readBody(req: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
    }
    return Buffer.concat(chunks).toString("utf8");
  }

  private writeJson(res: ServerResponse, status: number, payload: unknown) {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Access-Control-Allow-Origin",
      this.options.allowedOrigin || "*"
    );
    res.end(JSON.stringify(payload));
  }
}
