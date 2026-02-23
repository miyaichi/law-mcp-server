import readline from "node:readline";
import {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcRouter,
} from "./rpc.js";

export class StdioJsonRpcServer {
  constructor(private readonly router: JsonRpcRouter) {}

  start() {
    const rl = readline.createInterface({ input: process.stdin });
    rl.on("line", async (line) => {
      const message = this.parseMessage(line);
      if (!message) return;

      const response = await this.router.handle(message);
      if (response) {
        this.send(response);
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

  private send(payload: JsonRpcResponse) {
    process.stdout.write(JSON.stringify(payload) + "\n");
  }
}
