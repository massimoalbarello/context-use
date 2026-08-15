import { afterEach, describe, expect, test } from "bun:test";
import { app } from "./app.ts";

const authHandlerGlobal = globalThis as typeof globalThis & {
  __contextUseAuthHandler?: (request: Request) => Promise<Response> | Response;
};

const intentId = "33333333-3333-4333-8333-333333333333";
const routes = [
  { method: "POST", path: "/api/dashboard/knowledge-export-intents", body: '{"reset":true}' },
  { method: "POST", path: `/api/dashboard/knowledge-resets/${intentId}/clear`, body: "{}" },
  { method: "DELETE", path: `/api/dashboard/knowledge-export-intents/${intentId}`, body: "{}" },
] as const;

function request({ method, path, body }: { method: string; path: string; body: string }): Request {
  return new Request(`http://localhost:3000${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body,
  });
}

afterEach(() => {
  delete authHandlerGlobal.__contextUseAuthHandler;
});

describe("dashboard knowledge reset boundary", () => {
  test("requires an owner session for every step of the reset", async () => {
    authHandlerGlobal.__contextUseAuthHandler = () => new Response(null, { status: 401 });
    for (const route of routes) {
      expect((await app.handle(request(route))).status).toBe(401);
    }
  });

  test("asks for CSRF authorization before any mutating reset step", async () => {
    const kinds: string[] = [];
    authHandlerGlobal.__contextUseAuthHandler = async (authorization) => {
      const input = await authorization.json() as { kind?: string };
      kinds.push(input.kind ?? "");
      return new Response(null, { status: 401 });
    };
    for (const route of routes) {
      await app.handle(request(route));
    }
    expect(kinds).toEqual(routes.map(() => "json"));
  });

  test("rejects a malformed reset intent id before touching knowledge", async () => {
    authHandlerGlobal.__contextUseAuthHandler = () => Response.json({
      userId: "context-use-owner",
      sessionId: "session-id",
      email: "owner@example.com",
    });

    const response = await app.handle(new Request("http://localhost:3000/api/dashboard/knowledge-resets/not-a-uuid/clear", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }));
    expect(response.status).toBe(422);
  });
});
