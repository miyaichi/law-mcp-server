import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { JsonRpcRequest, JsonRpcResponse, JsonRpcRouter } from "./rpc.js";

type SSEServerOptions = {
  port: number;
  apiKey: string;
  heartbeatMs?: number;
  allowedOrigin?: string;
};

const AUTH_HEADER = "authorization";
const API_KEY_HEADER = "x-api-key";

const extractToken = (req: IncomingMessage) => {
  const authHeader = req.headers[AUTH_HEADER];
  const apiKeyHeader = req.headers[API_KEY_HEADER];

  if (typeof authHeader === "string") {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match) return match[1].trim();
  }

  if (typeof apiKeyHeader === "string") return apiKeyHeader.trim();
  if (Array.isArray(apiKeyHeader) && apiKeyHeader.length > 0)
    return apiKeyHeader[0]?.trim();

  return null;
};

export class SSEJsonRpcServer {
  private connections = new Set<ServerResponse>();

  constructor(
    private readonly router: JsonRpcRouter,
    private readonly options: SSEServerOptions
  ) {}

  start() {
    const server = createServer(async (req, res) => {
      if (req.method === "OPTIONS") {
        this.handleCors(res);
        return;
      }

      if (!this.isAuthorized(req)) {
        this.writeJson(res, 401, { error: "Unauthorized" });
        return;
      }

      if (req.method === "GET" && req.url?.startsWith("/events")) {
        this.handleEvents(req, res);
        return;
      }

      if (req.method === "POST" && req.url?.startsWith("/messages")) {
        await this.handleMessage(req, res);
        return;
      }

      if (req.method === "GET" && req.url === "/health") {
        this.writeJson(res, 200, { status: "ok" });
        return;
      }

      this.writeJson(res, 404, { error: "Not Found" });
    });

    server.listen(this.options.port, () => {
      console.log(`SSE server listening on port ${this.options.port}`);
    });
  }

  private handleCors(res: ServerResponse) {
    res.statusCode = 204;
    res.setHeader("Access-Control-Allow-Origin", this.options.allowedOrigin || "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-api-key");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.end();
  }

  private isAuthorized(req: IncomingMessage) {
    const token = extractToken(req);
    return token !== null && token === this.options.apiKey;
  }

  private handleEvents(_req: IncomingMessage, res: ServerResponse) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      Connection: "keep-alive",
      "Cache-Control": "no-cache",
      "Access-Control-Allow-Origin": this.options.allowedOrigin || "*",
    });

    const heartbeatMs = this.options.heartbeatMs ?? 15000;
    const heartbeat = setInterval(() => {
      res.write(`: heartbeat\n\n`);
    }, heartbeatMs);

    res.on("close", () => {
      clearInterval(heartbeat);
      this.connections.delete(res);
    });

    this.connections.add(res);
    res.write(`: connected\n\n`);
  }

  private async handleMessage(req: IncomingMessage, res: ServerResponse) {
    const body = await this.readBody(req);
    const message = this.parseMessage(body);
    if (!message) {
      this.writeJson(res, 400, { error: "Invalid JSON-RPC request" });
      return;
    }

    const response = await this.router.handle(message);
    if (response) {
      this.broadcast(response);
    }

    this.writeJson(res, 202, { status: "accepted" });
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
    } catch (error) {
      return null;
    }
  }

  private broadcast(payload: JsonRpcResponse) {
    const data = JSON.stringify(payload);
    for (const res of this.connections) {
      try {
        res.write(`event: message\n`);
        res.write(`data: ${data}\n\n`);
      } catch (error) {
        console.error("Failed to write SSE message", error);
        res.end();
        this.connections.delete(res);
      }
    }
  }

  private async readBody(req: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString("utf8");
  }

  private writeJson(res: ServerResponse, status: number, payload: unknown) {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", this.options.allowedOrigin || "*");
    res.end(JSON.stringify(payload));
  }
}
