#!/usr/bin/env node

import { StdioJsonRpcServer } from "./mcp.js";
import { tools, resolveTool, usageInstructions } from "./tools.js";
import { name, version } from "./config.js";

const server = new StdioJsonRpcServer();

const serverInfo = { name, version };

server.register("initialize", async (params) => {
  const payload = (params ?? {}) as { protocolVersion?: unknown };
  const protocolVersion =
    typeof payload.protocolVersion === "string"
      ? payload.protocolVersion
      : "2024-06-17";
  return {
    protocolVersion,
    serverInfo,
    instructions: usageInstructions,
    capabilities: {
      tools: {},
    },
  };
});

server.register("notifications/initialized", async () => {});

server.register("ping", async () => ({}));

server.register("tools/list", async () => ({
  tools: tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
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
  try {
    const result = await tool.handler(args);
    return { content: result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: message }],
      isError: true,
    };
  }
});

server.start();
