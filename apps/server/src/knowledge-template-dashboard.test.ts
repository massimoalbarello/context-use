import { afterEach, describe, expect, test } from "bun:test";
import { app } from "./app.ts";

const authHandlerGlobal = globalThis as typeof globalThis & {
  __contextUseAuthHandler?: (request: Request) => Promise<Response> | Response;
};

afterEach(() => {
  delete authHandlerGlobal.__contextUseAuthHandler;
});

describe("dashboard knowledge template boundary", () => {
  test("requires an owner session to plan or apply a template", async () => {
    authHandlerGlobal.__contextUseAuthHandler = () => new Response(null, { status: 401 });

    const plan = await app.handle(new Request("http://localhost:3000/api/dashboard/knowledge-template/plan"));
    const apply = await app.handle(new Request("http://localhost:3000/api/dashboard/knowledge-template/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ force_template: false }),
    }));

    expect(plan.status).toBe(401);
    expect(apply.status).toBe(401);
  });

  test("requests JSON and CSRF authorization before applying a template", async () => {
    let authorizationKind = "";
    authHandlerGlobal.__contextUseAuthHandler = async (request) => {
      const input = await request.json() as { kind?: string };
      authorizationKind = input.kind ?? "";
      return new Response(null, { status: 401 });
    };

    const response = await app.handle(new Request("http://localhost:3000/api/dashboard/knowledge-template/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ force_template: true }),
    }));

    expect(response.status).toBe(401);
    expect(authorizationKind).toBe("json");
  });

  test("rejects invalid force previews before querying template state", async () => {
    authHandlerGlobal.__contextUseAuthHandler = () => Response.json({
      userId: "context-use-owner",
      sessionId: "session-id",
      email: "owner@example.com",
    });

    const response = await app.handle(new Request("http://localhost:3000/api/dashboard/knowledge-template/plan?force_template=yes"));
    expect(response.status).toBe(422);
  });
});
