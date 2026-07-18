import { describe, expect, test } from "bun:test";
import type { PublicMessageWriter, PublicPageReader } from "./mcp-server.ts";
import { createPublicMcpRequestHandler } from "./handler.ts";

const reader: PublicPageReader = {
  async listPages() { return []; },
  async getPage() { return null; },
  async searchPages() { return []; },
};
const messages: PublicMessageWriter = {
  async create() { return { id: crypto.randomUUID() }; },
};
const endpoint = new URL("https://public.context.example.com/mcp");
const handler = createPublicMcpRequestHandler(reader, messages, endpoint, "https://context.example.com");

function request(init: RequestInit = {}, path = "/mcp"): Request {
  return new Request(`https://public.context.example.com${path}`, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      ...init.headers,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0.0" },
      },
    }),
    ...init,
  });
}

describe("public MCP HTTP boundary", () => {
  test("serves anonymous MCP requests without advertising resources", async () => {
    const response = await handler(request());
    const body = await response.json() as {
      result: { capabilities: Record<string, unknown>; serverInfo: { name: string } };
    };

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.result.serverInfo.name).toBe("context-use-public");
    expect(body.result.capabilities).toHaveProperty("tools");
    expect(body.result.capabilities).not.toHaveProperty("resources");
  });

  test("rejects every credential instead of confusing it with private MCP access", async () => {
    for (const headers of [{ authorization: "Bearer private-token" }, { cookie: "private=session" }]) {
      const response = await handler(request({ headers }));
      expect(response.status).toBe(400);
      expect(await response.text()).toBe("Credentials are not accepted by the public MCP server");
    }
  });

  test("rejects hostile browser origins and unsupported routes or methods", async () => {
    expect((await handler(request({ headers: { origin: "https://attacker.example" } }))).status).toBe(403);
    expect((await handler(request({ method: "GET", body: null }))).status).toBe(405);
    expect((await handler(request({}, "/private/mcp"))).status).toBe(404);
  });
});
