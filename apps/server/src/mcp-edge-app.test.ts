import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mcpEdgeApp } from "./mcp-edge-app.ts";

const assetId = "11111111-1111-4111-8111-111111111111";

describe("credentialless private MCP edge", () => {
  afterEach(() => {
    spyOn(globalThis, "fetch").mockRestore();
  });

  test("forwards only MCP protocol and exact asset capability routes", async () => {
    const forwarded: Request[] = [];
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (request: RequestInfo | URL) => {
      forwarded.push(request as Request);
      return new Response("ok");
    }) as typeof fetch);
    for (const request of [
      new Request("http://public.example/mcp", { method: "POST", headers: { authorization: "Bearer owner-approved-token" }, body: "{}" }),
      new Request(`http://public.example/api/mcp/assets/${assetId}/content`, { headers: { "x-context-use-download-token": "asset-token" } }),
      new Request("http://public.example/.well-known/oauth-protected-resource"),
    ]) {
      expect((await mcpEdgeApp.handle(request)).status).toBe(200);
    }

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(forwarded[0]!.url).toBe("http://localhost:3003/mcp");
    expect(forwarded[0]!.headers.get("host")).toBe("public.example");
    expect(forwarded[0]!.headers.get("authorization")).toBe("Bearer owner-approved-token");
    expect(forwarded[1]!.headers.get("x-context-use-download-token")).toBe("asset-token");
  });

  test("rejects dashboard, auth, malformed asset, and wrong-method requests", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(new Response("unexpected"));
    for (const request of [
      new Request("http://public.example/api/dashboard/pages"),
      new Request("http://public.example/api/auth/get-session"),
      new Request("http://public.example/api/mcp/assets/not-a-uuid/content"),
      new Request("http://public.example/mcp", { method: "PUT" }),
      new Request(`http://public.example/api/mcp/assets/${assetId}/content`, { method: "DELETE" }),
    ]) {
      expect((await mcpEdgeApp.handle(request)).status).toBe(404);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
