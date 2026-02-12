import readline from "node:readline";

type JsonRpcId = string | number | null;

type JsonRpcRequest = {
  jsonrpc: "2.0";
  method: string;
  id?: JsonRpcId;
  params?: unknown;
};

type JsonRpcError = {
  code: number;
  message: string;
};

type RequestHandler = (params: unknown) => Promise<unknown> | unknown;

export class StdioJsonRpcServer {
  private handlers = new Map<string, RequestHandler>();

  register(method: string, handler: RequestHandler) {
    this.handlers.set(method, handler);
  }

  start() {
    const rl = readline.createInterface({ input: process.stdin });
    rl.on("line", async (line) => {
      const message = this.parseMessage(line);
      if (!message) return;

      const { id, method, params } = message;
      const handler = this.handlers.get(method);
      if (!handler) {
        if (id !== undefined) {
          this.send({
            jsonrpc: "2.0",
            id,
            error: { code: -32601, message: "Method not found" },
          });
        }
        return;
      }
      try {
        const result = await handler(params ?? {});
        if (id !== undefined) {
          this.send({ jsonrpc: "2.0", id, result });
        }
      } catch (error) {
        if (id !== undefined) {
          const messageText =
            error instanceof Error ? error.message : String(error);
          this.send({
            jsonrpc: "2.0",
            id,
            error: { code: -32000, message: messageText },
          });
        }
      }
    });
  }

  private parseMessage(line: string): JsonRpcRequest | null {
    try {
      const parsed = JSON.parse(line) as JsonRpcRequest;
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

  private send(payload: {
    jsonrpc: "2.0";
    id: JsonRpcId;
    result?: unknown;
    error?: JsonRpcError;
  }) {
    process.stdout.write(JSON.stringify(payload) + "\n");
  }
}
