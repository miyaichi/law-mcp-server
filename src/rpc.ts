export type JsonRpcId = string | number | null;

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  method: string;
  id?: JsonRpcId;
  params?: unknown;
};

export type JsonRpcError = {
  code: number;
  message: string;
};

export type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: JsonRpcError;
};

type RequestHandler = (params: unknown) => Promise<unknown> | unknown;

export class JsonRpcRouter {
  private handlers = new Map<string, RequestHandler>();

  register(method: string, handler: RequestHandler) {
    this.handlers.set(method, handler);
  }

  async handle(request: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    if (request.jsonrpc !== "2.0" || typeof request.method !== "string") {
      return request.id === undefined
        ? null
        : {
            jsonrpc: "2.0",
            id: request.id,
            error: { code: -32600, message: "Invalid Request" },
          };
    }

    const handler = this.handlers.get(request.method);
    if (!handler) {
      return request.id === undefined
        ? null
        : {
            jsonrpc: "2.0",
            id: request.id,
            error: { code: -32601, message: "Method not found" },
          };
    }

    try {
      const result = await handler(request.params ?? {});
      return request.id === undefined
        ? null
        : { jsonrpc: "2.0", id: request.id, result };
    } catch (error) {
      return request.id === undefined
        ? null
        : {
            jsonrpc: "2.0",
            id: request.id,
            error: {
              code: -32000,
              message: error instanceof Error ? error.message : String(error),
            },
          };
    }
  }
}
