import { describe, expect, test } from "bun:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createStatelessMcpTransport } from "./mcp-transport.ts";

describe("stateless MCP transport", () => {
  test("materializes the initialize result before per-request cleanup", async () => {
    const server = new McpServer({ name: "transport-test", version: "1.0.0" });
    const transport = createStatelessMcpTransport();
    await server.connect(transport);

    const response = await transport.handleRequest(new Request("https://example.com/mcp", {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "transport-test", version: "1.0.0" },
        },
      }),
    }));

    await transport.close();
    await server.close();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: "2025-06-18",
        serverInfo: { name: "transport-test", version: "1.0.0" },
      },
    });
  });

  test("materializes the tool list before per-request cleanup", async () => {
    const server = new McpServer({ name: "transport-test", version: "1.0.0" });
    server.registerTool("ping", {
      description: "Return a test response.",
      inputSchema: z.object({}).strict(),
    }, async () => ({ content: [{ type: "text", text: "pong" }] }));
    const transport = createStatelessMcpTransport();
    await server.connect(transport);

    const response = await transport.handleRequest(new Request("https://example.com/mcp", {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": "2025-06-18",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    }));

    await transport.close();
    await server.close();

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      jsonrpc: "2.0",
      id: 2,
      result: { tools: [{ name: "ping" }] },
    });
  });
});
