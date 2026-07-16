import { afterAll, describe, expect, test } from "bun:test";
import { Client } from "pg";

const enabled = process.env.TEST_APP_DATABASE_URL === "1";
const application = enabled ? (await import("./app.ts")).app : null;
const describeApplication = enabled ? describe : describe.skip;
const createdClients: string[] = [];

describeApplication("HTTP credential and OAuth boundary", () => {
  afterAll(async () => {
    if (!process.env.TEST_DATABASE_URL) return;
    const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
    await client.connect();
    for (const clientId of createdClients) await client.query(`DELETE FROM "oauthClient" WHERE "clientId"=$1`, [clientId]);
    await client.end();
  });

  test("bearer credentials are rejected by publication APIs", async () => {
    const response = await application!.handle(new Request("http://localhost:3000/api/dashboard/publication-intents", {
      method: "POST",
      headers: { authorization: "Bearer forged", "content-type": "application/json" },
      body: "{}",
    }));
    expect(response.status).toBe(401);
  });

  test("cookie credentials are rejected by MCP with discovery metadata", async () => {
    const response = await application!.handle(new Request("http://localhost:3000/mcp", {
      method: "POST",
      headers: { cookie: "context-use.session_token=forged", "content-type": "application/json" },
      body: "{}",
    }));
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("oauth-protected-resource/mcp");
  });

  test("anonymous private access is rejected while malformed public identifiers are indistinguishable", async () => {
    const dashboard = await application!.handle(new Request("http://localhost:3000/api/dashboard/pages"));
    expect(dashboard.status).toBe(401);
    const malformedPage = await application!.handle(new Request("http://localhost:3000/p/INVALID"));
    const missingPage = await application!.handle(new Request("http://localhost:3000/p/missing-page"));
    expect(malformedPage.status).toBe(404);
    expect(missingPage.status).toBe(404);
    expect(await malformedPage.text()).toBe(await missingPage.text());
  });

  test("dynamic clients default to read-only and public clients cannot omit PKCE", async () => {
    const registration = await application!.handle(new Request("http://localhost:3000/api/auth/oauth2/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "context-use integration test",
        redirect_uris: ["http://127.0.0.1:49321/callback"],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      }),
    }));
    expect(registration.status).toBe(201);
    const client = await registration.json() as { client_id: string; scope: string };
    createdClients.push(client.client_id);
    expect(client.scope).toBe("kb:read");

    const authorization = new URL("http://localhost:3000/api/auth/oauth2/authorize");
    authorization.search = new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: "http://127.0.0.1:49321/callback",
      response_type: "code",
      scope: "kb:read",
      resource: "http://localhost:3000/mcp",
      state: "test-state",
    }).toString();
    const response = await application!.handle(new Request(authorization));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("error_description=pkce+is+required+for+public+clients");
  });
});
