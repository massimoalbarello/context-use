import { afterEach, describe, expect, test } from "bun:test";
import { app } from "./app.ts";
import { dashboardServices } from "./dashboard-services.ts";

const authHandlerGlobal = globalThis as typeof globalThis & {
  __contextUseAuthHandler?: (request: Request) => Promise<Response> | Response;
};

afterEach(() => {
  delete authHandlerGlobal.__contextUseAuthHandler;
});

describe("intrinsic dashboard services", () => {
  test("returns stable metadata without credentials or Nango internals", () => {
    expect(dashboardServices({
      NODE_ENV: "production",
      NANGO_PUBLIC_URL: "https://nango.context.example.com",
      NANGO_IMAGE_REFERENCE: "ghcr.io/example/nango@sha256:abc123",
    })).toEqual([{
      id: "nango",
      kind: "data-integration",
      name: "Nango",
      url: "https://nango.context.example.com",
      environment: "production",
      image_reference: "ghcr.io/example/nango@sha256:abc123",
      status: "configured",
    }]);
  });

  test("keeps the stable Nango registration visible when it is not configured", () => {
    expect(dashboardServices({
      NODE_ENV: "development",
      NANGO_PUBLIC_URL: "",
      NANGO_IMAGE_REFERENCE: "",
    })[0]).toMatchObject({
      id: "nango",
      url: null,
      image_reference: null,
      status: "not_configured",
    });
  });

  test("requires an owner session at the dashboard endpoint", async () => {
    authHandlerGlobal.__contextUseAuthHandler = () => new Response(null, { status: 401 });
    const response = await app.handle(new Request("http://localhost:3000/api/dashboard/services"));
    expect(response.status).toBe(401);
  });

  test("serves only metadata after owner authorization", async () => {
    authHandlerGlobal.__contextUseAuthHandler = () => Response.json({
      userId: "context-use-owner",
      sessionId: "session-id",
      email: "owner@example.com",
    });
    const response = await app.handle(new Request("http://localhost:3000/api/dashboard/services"));
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toEqual({
      services: [{
        id: "nango",
        kind: "data-integration",
        name: "Nango",
        url: null,
        environment: "test",
        image_reference: null,
        status: "not_configured",
      }],
    });
    expect(JSON.stringify(body)).not.toContain("key");
    expect(JSON.stringify(body)).not.toContain("password");
    expect(JSON.stringify(body)).not.toContain("connection");
    expect(JSON.stringify(body)).not.toContain("record");
  });
});
