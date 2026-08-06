import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { makeSignature } from "better-auth/crypto";
import { Client } from "pg";
import { config } from "./config.ts";
import { csrfToken } from "./security.ts";

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

  test("bearer credentials cannot create or confirm permanent page deletions", async () => {
    const intent = await application!.handle(new Request(
      "http://localhost:3000/api/dashboard/pages/11111111-1111-4111-8111-111111111111/deletion-intents",
      {
        method: "POST",
        headers: { authorization: "Bearer forged", "content-type": "application/json" },
        body: "{}",
      },
    ));
    expect(intent.status).toBe(401);

    const confirm = await application!.handle(new Request("http://localhost:3000/api/dashboard/page-deletions/confirm", {
      method: "POST",
      headers: { authorization: "Bearer forged", "content-type": "application/json" },
      body: "{}",
    }));
    expect(confirm.status).toBe(401);
  });

  test("passkey management is reachable only from an authenticated dashboard session", async () => {
    for (const [path, body] of [
      ["/api/dashboard/passkey-enrollment-intents", { name: "Attacker key", authenticator_attachment: null }],
      ["/api/dashboard/passkey-enrollment-intents/11111111-1111-4111-8111-111111111111/confirm", { response: {} }],
      ["/api/dashboard/passkeys/attacker/removal-intents", {}],
      ["/api/dashboard/passkeys/attacker/remove", {
        intent_id: "11111111-1111-4111-8111-111111111111",
        response: {},
      }],
    ] as const) {
      for (const headers of [{}, { authorization: "Bearer forged" }]) {
        const response = await application!.handle(new Request(`http://localhost:3000${path}`, {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify(body),
        }));
        expect(response.status).toBe(401);
      }
    }
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

    const deletion = await confirmation!.handle(new Request(
      "http://confirmation:3004/internal/browser-confirmation/page_deletion",
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
    expect(deletion.status).toBe(404);
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
    const nangoResponse = await authentication!.handle(new Request(
      "http://auth:3002/internal/authorize-nango",
      { headers: { authorization: "Bearer forged" } },
    ));
    expect(nangoResponse.status).toBe(404);
    const mcpResponse = await authentication!.handle(new Request(
      "http://auth:3002/internal/authorize-mcp",
      { headers: { authorization: "Bearer forged" } },
    ));
    expect(mcpResponse.status).toBe(404);
    const jwksWithoutCapability = await authentication!.handle(new Request(
      "http://auth:3002/internal/jwks",
    ));
    expect(jwksWithoutCapability.status).toBe(404);

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

  test("MCP transport methods always use the private MCP boundary", async () => {
    for (const method of ["GET", "DELETE"]) {
      const response = await application!.handle(new Request("http://localhost:3000/mcp", { method }));
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toContain("oauth-protected-resource/mcp");
    }
  });

  test("protected-resource discovery advertises only the knowledge resource", async () => {
    for (const [path, resource, resourceName] of [
      ["/.well-known/oauth-protected-resource", "http://localhost:3000/mcp", "context-use personal knowledge base"],
      ["/.well-known/oauth-protected-resource/mcp", "http://localhost:3000/mcp", "context-use personal knowledge base"],
    ] as const) {
      const response = await application!.handle(new Request(`http://localhost:3000${path}`));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        resource,
        resource_name: resourceName,
        scopes_supported: ["mcp:access"],
      });
    }
    expect((await application!.handle(new Request(
      "http://localhost:3000/.well-known/oauth-protected-resource/mcp/execution",
    ))).status).toBe(404);
    expect((await application!.handle(new Request(
      "http://localhost:3000/mcp/execution",
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
    ))).status).toBe(404);
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
    const malformedPage = await application!.handle(new Request("http://localhost:3000/p/INVALID"));
    const missingPage = await application!.handle(new Request("http://localhost:3000/p/missing-page"));
    expect(malformedPage.status).toBe(404);
    expect(missingPage.status).toBe(404);
    expect(await malformedPage.text()).toBe(await missingPage.text());
  });

  test("the optional introduction has a public empty state until it is published", async () => {
    const response = await application!.handle(new Request("http://localhost:3000/p/about/intro"));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("The owner has not published an introduction yet.");
  });

  test("nested /p paths resolve every published page and no private page", async () => {
    if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is required");
    const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
    const suffix = crypto.randomUUID().slice(0, 8);
    const publicPageId = crypto.randomUUID();
    const publicVersionId = crypto.randomUUID();
    const privatePageId = crypto.randomUUID();
    const privateVersionId = crypto.randomUUID();
    const parentDirectoryId = crypto.randomUUID();
    const nestedDirectoryId = crypto.randomUUID();
    const parentPath = `tests/${suffix}`;
    const nestedPath = `${parentPath}/nested`;
    const publicPath = `tests/${suffix}/nested/public-page`;
    const privatePath = `tests/${suffix}/nested/private-page`;
    await client.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO knowledge_directories(id,current_path,title,summary,search_vector)
         VALUES ($1,'tests','Tests','Integration test knowledge.',directory_search_vector('tests','Tests','Integration test knowledge.',''))
         ON CONFLICT (current_path) DO NOTHING`,
        [crypto.randomUUID()],
      );
      await client.query(
        `INSERT INTO knowledge_directories(id,current_path,title,summary,search_vector)
         VALUES
           ($1,$2,'PRIVATE-DIRECTORY-TITLE-CANARY','PRIVATE-DIRECTORY-SUMMARY-CANARY',directory_search_vector($2,'PRIVATE-DIRECTORY-TITLE-CANARY','PRIVATE-DIRECTORY-SUMMARY-CANARY','')),
           ($3,$4,'PRIVATE-NESTED-DIRECTORY-TITLE-CANARY','PRIVATE-NESTED-DIRECTORY-SUMMARY-CANARY',directory_search_vector($4,'PRIVATE-NESTED-DIRECTORY-TITLE-CANARY','PRIVATE-NESTED-DIRECTORY-SUMMARY-CANARY',''))`,
        [parentDirectoryId, parentPath, nestedDirectoryId, nestedPath],
      );
      await client.query(
        `INSERT INTO knowledge_pages(id,current_path,current_version_id,published_version_id,public_path)
         VALUES ($1,$2,$3,$3,$2),($4,$5,$6,NULL,NULL)`,
        [publicPageId, publicPath, publicVersionId, privatePageId, privatePath, privateVersionId],
      );
      await client.query(
        `INSERT INTO knowledge_page_versions(
           id,page_id,version_number,path,title,summary,body_markdown,commit_message,actor_kind,actor_subject
         ) VALUES
           ($1,$2,1,$3,'Nested public page','PUBLIC-SUMMARY-CANARY','PUBLIC-NESTED-CANARY','Create public fixture','dashboard','test'),
           ($4,$5,1,$6,'PRIVATE-TITLE-CANARY','PRIVATE-SUMMARY-CANARY','PRIVATE-NESTED-CANARY','Create private fixture','dashboard','test')`,
        [publicVersionId, publicPageId, publicPath, privateVersionId, privatePageId, privatePath],
      );
      await client.query("COMMIT");

      const published = await application!.handle(new Request(`http://localhost:3000/p/${publicPath}`));
      const publishedMarkdown = await application!.handle(new Request(`http://localhost:3000/p/${publicPath}.md`));
      const privatePage = await application!.handle(new Request(`http://localhost:3000/p/${privatePath}`));
      const privateMarkdown = await application!.handle(new Request(`http://localhost:3000/p/${privatePath}.md`));
      const missing = await application!.handle(new Request(`http://localhost:3000/p/tests/${suffix}/nested/missing-page`));
      const leafIndex = await application!.handle(new Request(`http://localhost:3000/p/${nestedPath}/`));
      const leafWithoutSlash = await application!.handle(new Request(`http://localhost:3000/p/${nestedPath}`));
      const parentIndex = await application!.handle(new Request(`http://localhost:3000/p/${parentPath}/`));
      const parentWithoutSlash = await application!.handle(new Request(`http://localhost:3000/p/${parentPath}`));
      const rootIndex = await application!.handle(new Request("http://localhost:3000/p/"));
      const rootWithoutSlash = await application!.handle(new Request("http://localhost:3000/p"));
      const llms = await application!.handle(new Request("http://localhost:3000/llms.txt"));
      const llmsFull = await application!.handle(new Request("http://localhost:3000/llms-full.txt"));

      expect(published.status).toBe(200);
      const publishedHtml = await published.text();
      expect(publishedHtml).toContain("PUBLIC-NESTED-CANARY");
      expect(publishedHtml).toContain(`href="/p/${nestedPath}/"`);
      expect(publishedHtml).toContain('href="/p/"');
      expect(publishedHtml).toContain(`<a href="/p/${publicPath}.md" type="text/markdown">View as Markdown</a>`);
      expect(publishedHtml).toContain('href="/llms.txt"');
      expect(publishedMarkdown.status).toBe(200);
      expect(publishedMarkdown.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
      const publishedMarkdownText = await publishedMarkdown.text();
      expect(publishedMarkdownText).toContain("# Nested public page");
      expect(publishedMarkdownText).toContain("PUBLIC-SUMMARY-CANARY");
      expect(publishedMarkdownText).toContain("PUBLIC-NESTED-CANARY");
      expect(privatePage.status).toBe(404);
      expect(await privatePage.text()).toBe(await missing.text());
      expect(privateMarkdown.status).toBe(404);
      expect(leafIndex.status).toBe(302);
      expect(leafIndex.headers.get("location")).toBe(`/p/${publicPath}`);
      expect(leafWithoutSlash.status).toBe(302);
      expect(leafWithoutSlash.headers.get("location")).toBe(`/p/${publicPath}`);
      expect(parentIndex.status).toBe(200);
      expect(parentWithoutSlash.status).toBe(308);
      expect(parentWithoutSlash.headers.get("location")).toBe(`/p/${parentPath}/`);
      expect(rootIndex.status).toBe(200);
      expect(rootIndex.headers.get("location")).toBeNull();
      const rootHtml = await rootIndex.text();
      expect(rootHtml).toContain('<a href="/">Home</a>');
      expect(rootHtml).toContain('<h1>Knowledge</h1>');
      expect(rootWithoutSlash.status).toBe(308);
      expect(rootWithoutSlash.headers.get("location")).toBe("/p/");
      const parentHtml = await parentIndex.text();
      expect(parentHtml).toContain("PRIVATE-DIRECTORY-TITLE-CANARY");
      expect(parentHtml).toContain("PRIVATE-NESTED-DIRECTORY-TITLE-CANARY");
      expect(parentHtml).toContain("PRIVATE-NESTED-DIRECTORY-SUMMARY-CANARY");
      expect(parentHtml).not.toContain("published page");
      expect(parentHtml).toContain(`href="/p/${publicPath}"`);
      expect(parentHtml).toContain('href="/llms.txt"');
      expect(llms.status).toBe(200);
      const llmsText = await llms.text();
      expect(llmsText).toContain(`${config.APP_ORIGIN}/p/${publicPath}.md`);
      expect(llmsText).not.toContain(privatePath);
      expect(llmsFull.status).toBe(200);
      const llmsFullText = await llmsFull.text();
      expect(llmsFullText).toContain("PUBLIC-NESTED-CANARY");
      expect(llmsFullText).not.toContain("PRIVATE-NESTED-CANARY");
      for (const privateCanary of [
        "PRIVATE-TITLE-CANARY",
        "PRIVATE-SUMMARY-CANARY",
        "PRIVATE-NESTED-CANARY",
        "PRIVATE-DIRECTORY-INTRO-CANARY",
        "PRIVATE-NESTED-DIRECTORY-INTRO-CANARY",
      ]) expect(parentHtml).not.toContain(privateCanary);

      await client.query(
        "UPDATE knowledge_pages SET published_version_id=NULL,public_path=NULL WHERE id=$1",
        [publicPageId],
      );
      const removedIndex = await application!.handle(new Request(`http://localhost:3000/p/${nestedPath}/`));
      const removedMarkdown = await application!.handle(new Request(`http://localhost:3000/p/${publicPath}.md`));
      expect(removedIndex.status).toBe(404);
      expect(removedMarkdown.status).toBe(404);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      await client.query("ALTER TABLE knowledge_pages DISABLE TRIGGER ALL");
      await client.query("DELETE FROM knowledge_pages WHERE id=ANY($1::uuid[])", [[publicPageId, privatePageId]]);
      await client.query("ALTER TABLE knowledge_pages ENABLE TRIGGER ALL");
      await client.query("DELETE FROM knowledge_page_versions WHERE page_id=ANY($1::uuid[])", [[publicPageId, privatePageId]]);
      await client.query(
        "DELETE FROM knowledge_directories WHERE current_path IN ($1,$2)",
        [nestedPath, parentPath],
      );
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

  test("passkey authentication cannot create a session while owner revocation holds its lock", async () => {
    if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is required");
    const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
    await client.connect();
    try {
      await client.query("SELECT pg_advisory_lock(hashtextextended($1,0))", ["context-use-owner"]);
      const response = await application!.handle(new Request(
        "http://localhost:3000/api/auth/passkey/verify-authentication",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ response: {} }),
        },
      ));
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: "passkey_authentication_in_progress" });
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", ["context-use-owner"]);
      await client.end();
    }
  });

  test("OAuth grants cannot issue tokens while owner revocation holds its lock", async () => {
    if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is required");
    const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
    await client.connect();
    try {
      await client.query("SELECT pg_advisory_lock(hashtextextended($1,0))", ["context-use-owner"]);
      const response = await application!.handle(new Request(
        "http://localhost:3000/api/auth/oauth2/token",
        {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            client_id: "untrusted-client",
            refresh_token: "untrusted-refresh-token",
          }),
        },
      ));
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("retry-after")).toBe("1");
      expect(await response.json()).toEqual({
        error: "temporarily_unavailable",
        error_description: "Owner authentication is changing",
      });
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", ["context-use-owner"]);
      await client.end();
    }
  });

  test("OAuth token bodies are fully received before taking the owner lock", async () => {
    if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is required");
    const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
    await client.connect();
    let releaseBody: () => void = () => {};
    let bodyReadStarted: () => void = () => {};
    const bodyCanFinish = new Promise<void>((resolve) => {
      releaseBody = resolve;
    });
    const readingSecondChunk = new Promise<void>((resolve) => {
      bodyReadStarted = resolve;
    });
    const encoder = new TextEncoder();
    let finishing = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("grant_type=refresh_token&"));
      },
      async pull(controller) {
        if (finishing) return;
        finishing = true;
        bodyReadStarted();
        await bodyCanFinish;
        controller.enqueue(encoder.encode("client_id=untrusted&refresh_token=untrusted"));
        controller.close();
      },
    });
    const tokenRequest = new Request(
      "http://localhost:3000/api/auth/oauth2/token",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      },
    );
    const pendingResponse = Promise.resolve().then(() => application!.handle(tokenRequest));

    try {
      await readingSecondChunk;
      const lock = await client.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked",
        ["context-use-owner"],
      );
      expect(lock.rows[0]?.locked).toBe(true);
      releaseBody();
      const response = await pendingResponse;
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ error: "temporarily_unavailable" });
    } finally {
      releaseBody();
      await client.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", ["context-use-owner"]);
      await client.end();
    }
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

  test("dynamic clients default to the private MCP grant and public clients cannot omit PKCE", async () => {
    const emailRegistration = await application!.handle(new Request("http://localhost:3000/api/auth/oauth2/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "untrusted email scope test",
        redirect_uris: ["http://127.0.0.1:49320/callback"],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code"],
        response_types: ["code"],
        scope: "openid email",
      }),
    }));
    expect(emailRegistration.status).toBe(400);

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
    expect(client.scope).toBe("mcp:access");

    for (const resource of ["http://localhost:3000/mcp"]) {
      const authorization = new URL("http://localhost:3000/api/auth/oauth2/authorize");
      authorization.search = new URLSearchParams({
        client_id: client.client_id,
        redirect_uri: "http://127.0.0.1:49321/callback",
        response_type: "code",
        scope: "mcp:access",
        resource,
        state: "test-state",
      }).toString();
      const response = await application!.handle(new Request(authorization));
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toContain("error_description=pkce+is+required+for+public+clients");
    }
  });

  test("a retried refresh rotation replays its replacement without invalidating the token family", async () => {
    if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is required");
    const registration = await application!.handle(new Request("http://localhost:3000/api/auth/oauth2/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "context-use refresh rotation test",
        redirect_uris: ["http://127.0.0.1:49322/callback"],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        scope: "offline_access mcp:access",
      }),
    }));
    expect(registration.status).toBe(201);
    const registered = await registration.json() as { client_id: string };
    createdClients.push(registered.client_id);

    const originalRefreshToken = `refresh-${crypto.randomUUID()}`;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(originalRefreshToken));
    const storedRefreshToken = Buffer.from(digest).toString("base64url");
    const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
    await client.connect();
    let createdOwner = false;
    try {
      const owner = await client.query(
        `INSERT INTO "user"(id,name,email,"emailVerified")
         VALUES ('context-use-owner','Owner',$1,true)
         ON CONFLICT (id) DO NOTHING
         RETURNING id`,
        [config.OWNER_EMAIL],
      );
      createdOwner = Boolean(owner.rowCount);
      await client.query(
        `INSERT INTO "oauthRefreshToken"(
           id,token,"clientId","userId","expiresAt","createdAt",scopes,resources
         ) VALUES ($1,$2,$3,'context-use-owner',now()+interval '30 days',now(),$4::jsonb,$5::jsonb)`,
        [
          crypto.randomUUID(),
          storedRefreshToken,
          registered.client_id,
          JSON.stringify(["offline_access", "mcp:access"]),
          JSON.stringify([config.MCP_RESOURCE]),
        ],
      );

      const refresh = (token: string) => application!.handle(new Request(
        "http://localhost:3000/api/auth/oauth2/token",
        {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            client_id: registered.client_id,
            refresh_token: token,
          }),
        },
      ));

      const firstResponse = await refresh(originalRefreshToken);
      expect(firstResponse.status).toBe(200);
      const first = await firstResponse.json() as {
        access_token: string;
        refresh_token: string;
      };
      expect(first.refresh_token).toBeTruthy();

      const replayResponse = await refresh(originalRefreshToken);
      expect(replayResponse.status).toBe(200);
      const replay = await replayResponse.json() as {
        access_token: string;
        refresh_token: string;
      };
      expect(replay.access_token).toBe(first.access_token);
      expect(replay.refresh_token).toBe(first.refresh_token);

      const replacementResponse = await refresh(first.refresh_token);
      expect(replacementResponse.status).toBe(200);
      const replacement = await replacementResponse.json() as { refresh_token: string };
      expect(replacement.refresh_token).toBeTruthy();
      expect(replacement.refresh_token).not.toBe(first.refresh_token);
    } finally {
      try {
        await client.query(`DELETE FROM "oauthClient" WHERE "clientId"=$1`, [registered.client_id]);
        if (createdOwner) {
          await client.query("BEGIN");
          try {
            await client.query("SET LOCAL session_replication_role=replica");
            await client.query(`DELETE FROM "user" WHERE id='context-use-owner'`);
            await client.query("COMMIT");
          } catch (error) {
            await client.query("ROLLBACK");
            throw error;
          }
        }
      } finally {
        await client.end();
      }
    }
  });

  test("idle and absolute session deadlines cannot be refreshed before authorization", async () => {
    if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is required");
    const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
    const sessions = [
      {
        id: crypto.randomUUID(),
        token: `idle-${crypto.randomUUID()}`,
        created: "-2 days",
        updated: "-13 hours",
        expires: "+5 days",
        expectedStatus: 401,
      },
      {
        id: crypto.randomUUID(),
        token: `absolute-${crypto.randomUUID()}`,
        created: "-8 days",
        updated: "-1 hour",
        expires: "+1 day",
        expectedStatus: 401,
      },
      {
        id: crypto.randomUUID(),
        token: `active-${crypto.randomUUID()}`,
        created: "-1 day",
        updated: "-2 hours",
        expires: "+5 days",
        expectedStatus: 200,
      },
    ];
    let createdOwner = false;
    await client.connect();
    try {
      const owner = await client.query(
        `INSERT INTO "user"(id,name,email,"emailVerified")
         VALUES ('context-use-owner','Owner',$1,true)
         ON CONFLICT (id) DO NOTHING
         RETURNING id`,
        [config.OWNER_EMAIL],
      );
      createdOwner = Boolean(owner.rowCount);
      for (const session of sessions) {
        await client.query(
          `INSERT INTO "session"(
             id,"expiresAt",token,"createdAt","updatedAt","userId"
           ) VALUES (
             $1,now()+$2::interval,$3,now()+$4::interval,now()+$5::interval,'context-use-owner'
           )`,
          [session.id, session.expires, session.token, session.created, session.updated],
        );
      }

      for (const session of sessions) {
        const signature = await makeSignature(session.token, config.BETTER_AUTH_SECRET);
        const before = await client.query<{ updatedAt: Date; expiresAt: Date }>(
          `SELECT "updatedAt","expiresAt" FROM "session" WHERE id=$1`,
          [session.id],
        );
        const response = await application!.handle(new Request("http://localhost:3000/api/dashboard/session", {
          headers: { cookie: `context-use.session_token=${session.token}.${signature}` },
        }));
        expect(response.status).toBe(session.expectedStatus);
        const after = await client.query<{ updatedAt: Date; expiresAt: Date }>(
          `SELECT "updatedAt","expiresAt" FROM "session" WHERE id=$1`,
          [session.id],
        );
        expect(after.rows[0]!.expiresAt.getTime()).toBe(before.rows[0]!.expiresAt.getTime());
        if (session.expectedStatus === 401) {
          expect(after.rows[0]!.updatedAt.getTime()).toBe(before.rows[0]!.updatedAt.getTime());
        } else {
          expect(after.rows[0]!.updatedAt.getTime()).toBeGreaterThan(before.rows[0]!.updatedAt.getTime());
        }
      }
    } finally {
      await client.query(
        `DELETE FROM "session" WHERE id=ANY($1::text[])`,
        [sessions.map(({ id }) => id)],
      ).catch(() => undefined);
      if (createdOwner) {
        await client.query('ALTER TABLE "user" DISABLE TRIGGER user_protect_owner_identity');
        try {
          await client.query(
            `DELETE FROM "user"
             WHERE id='context-use-owner'
               AND NOT EXISTS (SELECT 1 FROM passkey WHERE "userId"='context-use-owner')`,
          );
        } finally {
          await client.query('ALTER TABLE "user" ENABLE TRIGGER user_protect_owner_identity');
        }
      }
      await client.end();
    }
  });

  test("the fixed Nango client and live owner session are both required by the internal gateway", async () => {
    if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is required");
    const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
    const sessionId = crypto.randomUUID();
    const sessionToken = `nango-session-${crypto.randomUUID()}`;
    const accessToken = `nango-access-${crypto.randomUUID()}`;
    const unboundAccessToken = `nango-unbound-${crypto.randomUUID()}`;
    const accessTokenId = crypto.randomUUID();
    const unboundAccessTokenId = crypto.randomUUID();
    const storedAccessToken = Buffer.from(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(accessToken)),
    ).toString("base64url");
    const storedUnboundAccessToken = Buffer.from(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(unboundAccessToken)),
    ).toString("base64url");
    const expectedSecret = Buffer.from(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(config.NANGO_OAUTH_CLIENT_SECRET)),
    ).toString("base64url");
    let createdOwner = false;

    await client.connect();
    try {
      // Readiness is also the fail-closed provisioning boundary.
      expect((await authentication!.handle(new Request("http://auth:3002/health"))).status).toBe(200);
      const provisioned = await client.query<{
        clientId: string;
        clientSecret: string;
        disabled: boolean;
        skipConsent: boolean;
        scopes: string[];
        redirectUris: string[];
        tokenEndpointAuthMethod: string;
        grantTypes: string[];
        responseTypes: string[];
        public: boolean;
        type: string;
        requirePKCE: boolean;
      }>(
        `SELECT "clientId","clientSecret",disabled,"skipConsent",scopes,
                "redirectUris","tokenEndpointAuthMethod","grantTypes",
                "responseTypes",public,type,"requirePKCE"
         FROM "oauthClient" WHERE "clientId"=$1`,
        [config.NANGO_OAUTH_CLIENT_ID],
      );
      expect(provisioned.rows[0]).toMatchObject({
        clientId: config.NANGO_OAUTH_CLIENT_ID,
        clientSecret: expectedSecret,
        disabled: false,
        skipConsent: true,
        scopes: ["openid", "email"],
        redirectUris: [`${config.NANGO_ORIGIN}/_context-use-auth/callback`],
        tokenEndpointAuthMethod: "client_secret_basic",
        grantTypes: ["authorization_code"],
        responseTypes: ["code"],
        public: false,
        type: "web",
        requirePKCE: true,
      });

      const owner = await client.query(
        `INSERT INTO "user"(id,name,email,"emailVerified")
         VALUES ('context-use-owner','Owner',$1,true)
         ON CONFLICT (id) DO NOTHING
         RETURNING id`,
        [config.OWNER_EMAIL],
      );
      createdOwner = Boolean(owner.rowCount);
      await client.query(
        `INSERT INTO "session"(id,"expiresAt",token,"createdAt","updatedAt","userId")
         VALUES ($1,now()+interval '1 day',$2,now()-interval '1 hour',now()-interval '1 minute','context-use-owner')`,
        [sessionId, sessionToken],
      );
      await client.query(
        `INSERT INTO "oauthAccessToken"(
           id,token,"clientId","sessionId","userId","expiresAt","createdAt",scopes
         ) VALUES
           ($1,$2,$3,$4,'context-use-owner',now()+interval '10 minutes',now(),$5::jsonb),
           ($6,$7,$3,NULL,'context-use-owner',now()+interval '10 minutes',now(),$5::jsonb)`,
        [
          accessTokenId,
          storedAccessToken,
          config.NANGO_OAUTH_CLIENT_ID,
          sessionId,
          JSON.stringify(["openid", "email"]),
          unboundAccessTokenId,
          storedUnboundAccessToken,
        ],
      );

      const authorize = (token: string, capability = config.AUTH_NANGO_TOKEN) => authentication!.handle(new Request(
        "http://auth:3002/internal/authorize-nango",
        {
          headers: {
            authorization: `Bearer ${token}`,
            "x-context-use-nango-gateway": capability,
          },
        },
      ));

      expect((await authorize(accessToken, "wrong-capability-that-is-still-long-enough")).status).toBe(404);
      expect((await authorize(`forged-${crypto.randomUUID()}`)).status).toBe(401);
      expect((await authorize(unboundAccessToken)).status).toBe(401);
      expect((await authorize(accessToken)).status).toBe(204);

      await client.query(
        `UPDATE "session" SET "updatedAt"=now()-interval '13 hours' WHERE id=$1`,
        [sessionId],
      );
      expect((await authorize(accessToken)).status).toBe(401);
    } finally {
      await client.query(
        `DELETE FROM "oauthAccessToken" WHERE id=ANY($1::text[])`,
        [[accessTokenId, unboundAccessTokenId]],
      ).catch(() => undefined);
      await client.query(`DELETE FROM "session" WHERE id=$1`, [sessionId]).catch(() => undefined);
      if (createdOwner) {
        await client.query('ALTER TABLE "user" DISABLE TRIGGER user_protect_owner_identity');
        try {
          await client.query(
            `DELETE FROM "user"
             WHERE id='context-use-owner'
               AND NOT EXISTS (SELECT 1 FROM passkey WHERE "userId"='context-use-owner')`,
          );
        } finally {
          await client.query('ALTER TABLE "user" ENABLE TRIGGER user_protect_owner_identity');
        }
      }
      await client.end();
    }
  });

  test("the MCP gateway requires an active token bound to a live owner session", async () => {
    if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is required");
    const registration = await application!.handle(new Request("http://localhost:3000/api/auth/oauth2/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "context-use MCP gateway test",
        redirect_uris: ["http://127.0.0.1:49323/callback"],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        scope: "offline_access mcp:access",
      }),
    }));
    expect(registration.status).toBe(201);
    const registered = await registration.json() as { client_id: string };
    createdClients.push(registered.client_id);

    const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
    const sessionId = crypto.randomUUID();
    const sessionToken = `mcp-session-${crypto.randomUUID()}`;
    const refreshToken = `mcp-refresh-${crypto.randomUUID()}`;
    const refreshTokenId = crypto.randomUUID();
    const consentId = crypto.randomUUID();
    const storedRefreshToken = Buffer.from(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(refreshToken)),
    ).toString("base64url");
    let createdOwner = false;

    await client.connect();
    try {
      const owner = await client.query(
        `INSERT INTO "user"(id,name,email,"emailVerified")
         VALUES ('context-use-owner','Owner',$1,true)
         ON CONFLICT (id) DO NOTHING
         RETURNING id`,
        [config.OWNER_EMAIL],
      );
      createdOwner = Boolean(owner.rowCount);
      await client.query(
        `INSERT INTO "session"(id,"expiresAt",token,"createdAt","updatedAt","userId")
         VALUES ($1,now()+interval '1 day',$2,now()-interval '1 hour',now()-interval '1 minute','context-use-owner')`,
        [sessionId, sessionToken],
      );
      await client.query(
        `INSERT INTO "oauthConsent"(
           id,"clientId","userId",scopes,resources,"createdAt","updatedAt"
         ) VALUES ($1,$2,'context-use-owner',$3::jsonb,$4::jsonb,now(),now())`,
        [
          consentId,
          registered.client_id,
          JSON.stringify(["offline_access", "mcp:access"]),
          JSON.stringify([config.MCP_RESOURCE]),
        ],
      );
      await client.query(
        `INSERT INTO "oauthRefreshToken"(
           id,token,"clientId","sessionId","userId","expiresAt","createdAt",scopes,resources
         ) VALUES ($1,$2,$3,$4,'context-use-owner',now()+interval '30 days',now(),$5::jsonb,$6::jsonb)`,
        [
          refreshTokenId,
          storedRefreshToken,
          registered.client_id,
          sessionId,
          JSON.stringify(["offline_access", "mcp:access"]),
          JSON.stringify([config.MCP_RESOURCE]),
        ],
      );

      const tokenResponse = await application!.handle(new Request(
        "http://localhost:3000/api/auth/oauth2/token",
        {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            client_id: registered.client_id,
            refresh_token: refreshToken,
          }),
        },
      ));
      expect(tokenResponse.status).toBe(200);
      const issued = await tokenResponse.json() as { access_token: string };
      expect(issued.access_token.split(".")).toHaveLength(3);
      const opaqueRows = await client.query(
        `SELECT 1 FROM "oauthAccessToken" WHERE "clientId"=$1`,
        [registered.client_id],
      );
      expect(opaqueRows.rowCount).toBe(0);

      const authorize = (token: string, capability = config.AUTH_MCP_TOKEN) => authentication!.handle(new Request(
        "http://auth:3002/internal/authorize-mcp",
        {
          headers: {
            authorization: `Bearer ${token}`,
            "x-context-use-mcp-gateway": capability,
          },
        },
      ));
      const authorizeLineage = () => authentication!.handle(new Request(
        "http://auth:3002/internal/authorize-mcp",
        {
          headers: {
            "x-context-use-mcp-client": registered.client_id,
            "x-context-use-mcp-gateway": config.AUTH_MCP_TOKEN,
            "x-context-use-mcp-session": sessionId,
          },
        },
      ));

      expect((await authorize(issued.access_token, "wrong-capability-that-is-still-long-enough")).status).toBe(404);
      expect((await authorize(`forged-${crypto.randomUUID()}`)).status).toBe(401);
      const active = await authorize(issued.access_token);
      expect(active.status).toBe(200);
      expect(await active.json()).toEqual({ client_id: registered.client_id });
      expect((await authorizeLineage()).status).toBe(204);

      await client.query(`UPDATE "session" SET "updatedAt"=now()-interval '13 hours' WHERE id=$1`, [sessionId]);
      expect((await authorize(issued.access_token)).status).toBe(401);
      expect((await authorizeLineage()).status).toBe(401);
      await client.query(`UPDATE "session" SET "updatedAt"=now() WHERE id=$1`, [sessionId]);
      expect((await authorize(issued.access_token)).status).toBe(200);
      expect((await authorizeLineage()).status).toBe(204);

      const signature = await makeSignature(sessionToken, config.BETTER_AUTH_SECRET);
      const disconnect = await authentication!.handle(new Request(
        `http://localhost:3000/api/dashboard/oauth-clients/${encodeURIComponent(registered.client_id)}`,
        {
          method: "DELETE",
          headers: {
            "content-type": "application/json",
            cookie: `context-use.session_token=${sessionToken}.${signature}`,
            origin: config.APP_ORIGIN,
            "sec-fetch-site": "same-origin",
            "x-csrf-token": csrfToken({
              userId: "context-use-owner",
              sessionId,
              email: config.OWNER_EMAIL,
            }),
          },
        },
      ));
      expect(disconnect.status).toBe(200);
      expect(await disconnect.json()).toEqual({ revoked: true });
      expect((await authorize(issued.access_token)).status).toBe(401);
      expect((await authorizeLineage()).status).toBe(401);
      const removedClient = await client.query(
        `SELECT 1 FROM "oauthClient" WHERE "clientId"=$1`,
        [registered.client_id],
      );
      expect(removedClient.rowCount).toBe(0);
    } finally {
      await client.query(`DELETE FROM "oauthClient" WHERE "clientId"=$1`, [registered.client_id]).catch(() => undefined);
      await client.query(`DELETE FROM "session" WHERE id=$1`, [sessionId]).catch(() => undefined);
      if (createdOwner) {
        await client.query('ALTER TABLE "user" DISABLE TRIGGER user_protect_owner_identity');
        try {
          await client.query(
            `DELETE FROM "user"
             WHERE id='context-use-owner'
               AND NOT EXISTS (SELECT 1 FROM passkey WHERE "userId"='context-use-owner')`,
          );
        } finally {
          await client.query('ALTER TABLE "user" ENABLE TRIGGER user_protect_owner_identity');
        }
      }
      await client.end();
    }
  });

  test("JWKS endpoint can provision the configured signing key", async () => {
    const response = await application!.handle(new Request("http://localhost:3000/api/auth/jwks"));
    expect(response.status).toBe(200);
    const body = await response.json() as { keys: Array<{ alg: string; crv: string }> };
    expect(body.keys).toContainEqual(expect.objectContaining({ alg: "EdDSA", crv: "Ed25519" }));

    const internal = await authentication!.handle(new Request("http://auth:3002/internal/jwks", {
      headers: { authorization: `Bearer ${config.AUTH_MCP_TOKEN}` },
    }));
    expect(internal.status).toBe(200);
    expect((await internal.json() as { keys: unknown[] }).keys.length).toBeGreaterThan(0);
  });
});
