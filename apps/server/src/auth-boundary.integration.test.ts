import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { Client } from "pg";

const enabled = process.env.TEST_APP_DATABASE_URL === "1";
const application = enabled ? (await import("./combined-app.ts")).combinedApp : null;
const authentication = enabled ? (await import("./auth-app.ts")).authApp : null;
const confirmation = enabled ? (await import("./confirmation-app.ts")).confirmationApp : null;
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

    const confirm = await application!.handle(new Request("http://localhost:3000/api/dashboard/publications/confirm", {
      method: "POST",
      headers: { authorization: "Bearer forged", "content-type": "application/json" },
      body: "{}",
    }));
    expect(confirm.status).toBe(401);
  });

  test("bearer and anonymous credentials cannot reach knowledge export APIs", async () => {
    const intent = await application!.handle(new Request("http://localhost:3000/api/dashboard/knowledge-export-intents", {
      method: "POST",
      headers: { authorization: "Bearer forged", "content-type": "application/json" },
      body: "{}",
    }));
    expect(intent.status).toBe(401);
    const download = await application!.handle(new Request(
      "http://localhost:3000/api/dashboard/knowledge-exports/11111111-1111-4111-8111-111111111111/download",
      { headers: { "sec-fetch-site": "same-origin" } },
    ));
    expect(download.status).toBe(401);
    const confirm = await application!.handle(new Request("http://localhost:3000/api/dashboard/knowledge-exports/confirm", {
      method: "POST",
      headers: { authorization: "Bearer forged", "content-type": "application/json" },
      body: "{}",
    }));
    expect(confirm.status).toBe(401);
  });

  test("confirmation browser handlers are internal and require the auth gateway capability", async () => {
    const response = await confirmation!.handle(new Request(
      "http://confirmation:3004/internal/browser-confirmation/publication",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          principal: { owner_user_id: "context-use-owner", session_id: "forged" },
          confirmation: {
            intent_id: "11111111-1111-4111-8111-111111111111",
            response: {},
          },
        }),
      },
    ));
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("gateway");
  });

  test("every non-browser internal endpoint requires its pairwise service capability", async () => {
    const authResponse = await authentication!.handle(new Request(
      "http://auth:3002/internal/authorize-dashboard",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          method: "GET",
          pathname: "/api/dashboard/pages",
          kind: "read",
          headers: {},
        }),
      },
    ));
    expect(authResponse.status).toBe(404);

    const confirmationResponse = await confirmation!.handle(new Request(
      "http://confirmation:3004/internal/confirmation/publication/11111111-1111-4111-8111-111111111111/options",
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
    ));
    expect(confirmationResponse.status).toBe(404);
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

  test("MCP transport methods take precedence over the public asset route", async () => {
    for (const method of ["GET", "DELETE"]) {
      const response = await application!.handle(new Request("http://localhost:3000/mcp", { method }));

      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toContain("oauth-protected-resource/mcp");
    }
  });

  test("private asset access requires a dashboard session on the dashboard origin", async () => {
    const dashboard = await application!.handle(new Request("http://localhost:3000/api/dashboard/pages"));
    expect(dashboard.status).toBe(401);
    for (const headers of [{}, { authorization: "Bearer forged" }]) {
      const privateAsset = await application!.handle(new Request(
        "http://localhost:3000/api/dashboard/assets/11111111-1111-4111-8111-111111111111/content",
        { headers },
      ));
      expect(privateAsset.status).toBe(401);
    }
    const wrongOrigin = await application!.handle(new Request(
      "http://assets.localhost:3000/api/dashboard/assets/11111111-1111-4111-8111-111111111111/content",
    ));
    expect(wrongOrigin.status).toBe(404);
  });

  test("malformed public identifiers are indistinguishable", async () => {
    const inbox = await application!.handle(new Request("http://localhost:3000/api/dashboard/messages"));
    expect(inbox.status).toBe(401);
    const malformedPage = await application!.handle(new Request("http://localhost:3000/p/INVALID"));
    const missingPage = await application!.handle(new Request("http://localhost:3000/p/missing-page"));
    expect(malformedPage.status).toBe(404);
    expect(missingPage.status).toBe(404);
    expect(await malformedPage.text()).toBe(await missingPage.text());
  });

  test("nested /p paths resolve every published page and no private page", async () => {
    if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is required");
    const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
    const suffix = crypto.randomUUID().slice(0, 8);
    const publicPageId = crypto.randomUUID();
    const publicVersionId = crypto.randomUUID();
    const privatePageId = crypto.randomUUID();
    const privateVersionId = crypto.randomUUID();
    const publicPath = `tests/${suffix}/nested/public-page`;
    const privatePath = `tests/${suffix}/nested/private-page`;
    await client.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO knowledge_pages(id,current_path,current_version_id,published_version_id,public_path)
         VALUES ($1,$2,$3,$3,$2),($4,$5,$6,NULL,NULL)`,
        [publicPageId, publicPath, publicVersionId, privatePageId, privatePath, privateVersionId],
      );
      await client.query(
        `INSERT INTO knowledge_page_versions(
           id,page_id,version_number,path,title,body_markdown,commit_message,actor_kind,actor_subject
         ) VALUES
           ($1,$2,1,$3,'Nested public page','PUBLIC-NESTED-CANARY','Create public fixture','dashboard','test'),
           ($4,$5,1,$6,'Nested private page','PRIVATE-NESTED-CANARY','Create private fixture','dashboard','test')`,
        [publicVersionId, publicPageId, publicPath, privateVersionId, privatePageId, privatePath],
      );
      await client.query("COMMIT");

      const published = await application!.handle(new Request(`http://localhost:3000/p/${publicPath}`));
      const privatePage = await application!.handle(new Request(`http://localhost:3000/p/${privatePath}`));
      const missing = await application!.handle(new Request(`http://localhost:3000/p/tests/${suffix}/nested/missing-page`));

      expect(published.status).toBe(200);
      expect(await published.text()).toContain("PUBLIC-NESTED-CANARY");
      expect(privatePage.status).toBe(404);
      expect(await privatePage.text()).toBe(await missing.text());
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      await client.query("ALTER TABLE knowledge_pages DISABLE TRIGGER ALL");
      await client.query("DELETE FROM knowledge_pages WHERE id=ANY($1::uuid[])", [[publicPageId, privatePageId]]);
      await client.query("ALTER TABLE knowledge_pages ENABLE TRIGGER ALL");
      await client.query("DELETE FROM knowledge_page_versions WHERE page_id=ANY($1::uuid[])", [[publicPageId, privatePageId]]);
      await client.end();
    }
  });

  test("audit history endpoint is absent", async () => {
    const response = await application!.handle(new Request("http://localhost:3000/api/dashboard/audit"));
    expect(response.status).toBe(404);
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
    expect(client.scope).toBe("kb:read kb:write assets:read assets:write skills:read skills:write automations:write automations:claim automations:execute");

    const authorization = new URL("http://localhost:3000/api/auth/oauth2/authorize");
    authorization.search = new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: "http://127.0.0.1:49321/callback",
      response_type: "code",
      scope: "kb:read kb:write assets:read assets:write skills:read skills:write automations:write automations:claim automations:execute",
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
