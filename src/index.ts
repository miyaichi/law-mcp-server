#!/usr/bin/env node

import { StdioJsonRpcServer } from "./mcp.js";
import { tools, resolveTool, usageInstructions } from "./tools.js";
import { name, version } from "./config.js";
import { JsonRpcRouter } from "./rpc.js";
import { SSEJsonRpcServer } from "./sse.js";
import { StreamableHttpServer } from "./http.js";
import { OAuthServer } from "./oauth.js";

const router = new JsonRpcRouter();

const serverInfo = { name, version };

router.register("initialize", async (params) => {
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

router.register("notifications/initialized", async () => {});

router.register("ping", async () => ({}));

router.register("tools/list", async () => ({
  tools: tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  })),
}));

router.register("tools/call", async (params) => {
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

const transport = (process.env.TRANSPORT || "stdio").toLowerCase();

if (transport === "stdio") {
  const server = new StdioJsonRpcServer(router);
  server.start();
} else if (transport === "sse" || transport === "http") {
  const apiKey = process.env.API_KEY?.trim();
  if (!apiKey) {
    console.error(`API_KEY is required when TRANSPORT=${transport}`);
    process.exit(1);
  }

  const parsedPort = Number(process.env.PORT || "3000");
  const port = Number.isFinite(parsedPort) ? parsedPort : 3000;
  const allowedOrigin = process.env.ALLOWED_ORIGIN?.trim();

  if (transport === "http") {
    const issuerUrl = process.env.ISSUER_URL?.trim();
    const oauth = issuerUrl
      ? new OAuthServer({ issuerUrl, apiKey })
      : undefined;

    if (!oauth) {
      console.warn(
        "ISSUER_URL is not set — OAuth disabled. " +
          "Set ISSUER_URL to the public URL of this server to enable Claude.ai connector registration."
      );
    }

    const server = new StreamableHttpServer(router, {
      port,
      apiKey,
      allowedOrigin,
      oauth,
    });
    server.start();
  } else {
    const server = new SSEJsonRpcServer(router, {
      port,
      apiKey,
      allowedOrigin,
    });
    server.start();
  }
} else {
  console.error(
    `Unknown TRANSPORT "${transport}". Use "stdio", "sse", or "http".`
  );
  process.exit(1);
}
