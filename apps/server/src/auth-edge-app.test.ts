import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { authEdgeApp } from "./auth-edge-app.ts";

describe("unprivileged authentication edge", () => {
  afterEach(() => {
    spyOn(globalThis, "fetch").mockRestore();
  });

  test("forwards only the public authentication protocol without a reusable capability", async () => {
    const forwarded: Request[] = [];
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (request: RequestInfo | URL) => {
      forwarded.push(request as Request);
      return Response.json({ ok: true });
    }) as typeof fetch);
    const response = await authEdgeApp.handle(new Request(
      "http://public.example/api/auth/get-session?disableCookieCache=true",
      {
        headers: {
          "x-context-use-auth-edge": "attacker-controlled",
          cookie: "context-use.session_token=browser-cookie",
        },
      },
    ));

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(forwarded[0]!.url).toBe("http://localhost:3002/api/auth/get-session?disableCookieCache=true");
    expect(forwarded[0]!.headers.has("x-context-use-auth-edge")).toBe(false);
    expect(forwarded[0]!.headers.get("cookie")).toBe("context-use.session_token=browser-cookie");
  });

  test("does not expose an internal authority route", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(new Response("unexpected"));
    const response = await authEdgeApp.handle(new Request(
      "http://public.example/internal/authorize-dashboard",
      { method: "POST", body: "{}" },
    ));

    expect(response.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("forwards only the public OAuth discovery documents", async () => {
    const forwarded: Request[] = [];
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (request: RequestInfo | URL) => {
      forwarded.push(request as Request);
      return Response.json({ issuer: "https://public.example" });
    }) as typeof fetch);

    for (const path of ["/.well-known/oauth-authorization-server", "/.well-known/openid-configuration"]) {
      const response = await authEdgeApp.handle(new Request(`http://public.example${path}`));
      expect(response.status).toBe(200);
    }

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(forwarded.map((request) => new URL(request.url).pathname)).toEqual([
      "/.well-known/oauth-authorization-server",
      "/.well-known/openid-configuration",
    ]);
  });

  test("does not forward unused or privileged Better Auth endpoints", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(new Response("unexpected"));
    for (const [path, method] of [
      ["/api/auth/sign-in/email", "POST"],
      ["/api/auth/token", "GET"],
      ["/api/auth/passkey/list-user-passkeys", "GET"],
      ["/api/auth/admin/oauth2/resources", "GET"],
      ["/api/auth/oauth2/token", "GET"],
    ] as const) {
      const response = await authEdgeApp.handle(new Request(`http://public.example${path}`, { method }));
      expect(response.status).toBe(404);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
