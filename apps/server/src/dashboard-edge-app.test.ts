import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { dashboardEdgeApp } from "./dashboard-edge-app.ts";

describe("credentialless dashboard edge", () => {
  afterEach(() => {
    spyOn(globalThis, "fetch").mockRestore();
  });

  test("forwards dashboard requests and strips spoofed pairwise headers", async () => {
    const forwarded: Request[] = [];
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (request: RequestInfo | URL) => {
      forwarded.push(request as Request);
      return Response.json({ ok: true });
    }) as typeof fetch);
    const response = await dashboardEdgeApp.handle(new Request(
      "http://public.example/api/dashboard/pages?limit=10",
      {
        headers: {
          cookie: "context-use.session_token=browser-cookie",
          "x-context-use-dashboard-gateway": "attacker-controlled",
        },
      },
    ));

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(forwarded[0]!.url).toBe("http://localhost:3000/api/dashboard/pages?limit=10");
    expect(forwarded[0]!.headers.get("host")).toBe("public.example");
    expect(forwarded[0]!.headers.get("cookie")).toBe("context-use.session_token=browser-cookie");
    expect(forwarded[0]!.headers.has("x-context-use-dashboard-gateway")).toBe(false);
  });

  test("serves only the dashboard/static route families", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
    expect((await dashboardEdgeApp.handle(new Request("http://public.example/app/login"))).status).toBe(200);
    expect((await dashboardEdgeApp.handle(new Request("http://public.example/assets/app.js"))).status).toBe(200);
    expect((await dashboardEdgeApp.handle(new Request("http://public.example/api/auth/get-session"))).status).toBe(404);
    expect((await dashboardEdgeApp.handle(new Request("http://public.example/mcp", { method: "POST" }))).status).toBe(404);
    expect((await dashboardEdgeApp.handle(new Request("http://public.example/app/login", { method: "POST" }))).status).toBe(404);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
