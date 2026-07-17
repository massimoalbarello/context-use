import { afterAll, describe, expect, spyOn, test } from "bun:test";
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

  test("owner enrollment requires the configured email and setup capability", async () => {
    const invalid = new URL("http://localhost:3000/api/auth/passkey/generate-register-options");
    invalid.searchParams.set("context", JSON.stringify({
      email: "attacker@example.com",
      token: "development-owner-setup-token-0000000000000",
    }));
    expect((await application!.handle(new Request(invalid))).status).toBe(403);

    const valid = new URL("http://localhost:3000/api/auth/passkey/generate-register-options");
    valid.searchParams.set("context", JSON.stringify({
      email: "owner@example.com",
      token: "development-owner-setup-token-0000000000000",
    }));
    const response = await application!.handle(new Request(valid));
    expect(response.status).toBe(200);
    const options = await response.json() as {
      authenticatorSelection: { residentKey: string; requireResidentKey: boolean; userVerification: string };
    };
    expect(options.authenticatorSelection).toMatchObject({
      residentKey: "required",
      requireResidentKey: true,
      userVerification: "required",
    });
  });

  test("passkey sign-in options require user verification without an email", async () => {
    const response = await application!.handle(new Request(
      "http://localhost:3000/api/auth/passkey/generate-authenticate-options",
    ));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ userVerification: "required" });
  });

  test("Google social sign-in is not configured", async () => {
    const errorLog = spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const response = await application!.handle(new Request("http://localhost:3000/api/auth/sign-in/social", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({ provider: "google", callbackURL: "http://localhost:3000/app" }),
      }));
      expect(response.ok).toBe(false);
    } finally {
      errorLog.mockRestore();
    }
  });

  test("dynamic clients default to all MCP tool scopes and public clients cannot omit PKCE", async () => {
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
    expect(client.scope).toBe("kb:read kb:write assets:read");

    const authorization = new URL("http://localhost:3000/api/auth/oauth2/authorize");
    authorization.search = new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: "http://127.0.0.1:49321/callback",
      response_type: "code",
      scope: "kb:read kb:write assets:read",
      resource: "http://localhost:3000/mcp",
      state: "test-state",
    }).toString();
    const response = await application!.handle(new Request(authorization));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("error_description=pkce+is+required+for+public+clients");
  });

  test("JWKS endpoint can provision the configured signing key", async () => {
    const response = await application!.handle(new Request("http://localhost:3000/api/auth/jwks"));
    expect(response.status).toBe(200);
    const body = await response.json() as { keys: Array<{ alg: string; crv: string }> };
    expect(body.keys).toContainEqual(expect.objectContaining({ alg: "EdDSA", crv: "Ed25519" }));
  });
});
