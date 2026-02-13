#!/usr/bin/env node

import { StdioJsonRpcServer } from "./mcp.js";
import { tools, resolveTool } from "./tools.js";

const server = new StdioJsonRpcServer();

const serverInfo = { name: "law-mcp-server", version: "0.1.5" };

server.register("initialize", async (params) => {
  const payload = (params ?? {}) as { protocolVersion?: unknown };
  const protocolVersion =
    typeof payload.protocolVersion === "string"
      ? payload.protocolVersion
      : "2024-06-17";
  return {
    protocolVersion,
    serverInfo,
    capabilities: {
      tools: {
        list: true,
        call: true,
      },
    },
  };
});

server.register("ping", async () => ({ ok: true }));

server.register("tools/list", async () => ({
  tools: tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
  })),
}));

server.register("tools/call", async (params) => {
  const payload = (params ?? {}) as { name?: unknown; arguments?: unknown };
  if (typeof payload.name !== "string") {
    throw new Error("Tool name is required and must be a string");
  }
  const tool = resolveTool(payload.name);
  if (!tool) {
    throw new Error(`Tool ${payload.name} is not available`);
  }
  const args =
    payload.arguments && typeof payload.arguments === "object"
      ? (payload.arguments as Record<string, unknown>)
      : {};
  const result = await tool.handler(args);
  return { content: result };
});

server.start();
