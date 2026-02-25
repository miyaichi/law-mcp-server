import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { JsonRpcRequest, JsonRpcRouter } from "./rpc.js";

export type StreamableHttpOptions = {
  port: number;
  apiKey: string;
  allowedOrigin?: string;
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

      if (!this.isAuthorized(req)) {
        res.setHeader(
          "WWW-Authenticate",
          `Bearer realm="${this.options.allowedOrigin || "*"}"`
        );
        this.writeJson(res, 401, { error: "Unauthorized" });
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
      // initialize は常に新規セッションを作成する
      const newId = randomUUID();
      session = { id: newId };
      this.sessions.set(newId, session);
    } else {
      // その他のメソッドは既存セッションが必要
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

    // id なし（notification）は 202 Accepted で応答
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

  // GET /mcp: サーバー起点メッセージ用の SSE ストリーム
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

  // DELETE /mcp: セッション終了
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

  private isAuthorized(req: IncomingMessage): boolean {
    const token = extractToken(req);
    return token !== null && token === this.options.apiKey;
  }

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
    res.setHeader(
      "Access-Control-Expose-Headers",
      SESSION_HEADER
    );
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
