import { afterEach, describe, expect, spyOn, test } from "bun:test";
import type { AssetRepository, DirectoryRepository, PageRepository } from "@context-use/database";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { config } from "./config.ts";
import { createMcpRequestHandler } from "./mcp.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

async function accessToken(audience: string, privateKey: CryptoKey): Promise<string> {
  return new SignJWT({
    azp: "profile-test-client",
    principal_type: "mcp_agent",
    scope: "mcp:access",
    sid: "profile-test-session",
  })
    .setProtectedHeader({ alg: "EdDSA", kid: "profile-test-key" })
    .setIssuer(config.OAUTH_ISSUER)
    .setAudience(audience)
    .setSubject("context-use-owner")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
}

function toolListRequest(endpoint: string, token: string): Request {
  return new Request(endpoint, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "mcp-protocol-version": "2025-06-18",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
}

describe("MCP audience binding", () => {
  test("accepts only tokens bound exclusively to the knowledge resource", async () => {
    const { publicKey, privateKey } = await generateKeyPair("EdDSA");
    const publicJwk = await exportJWK(publicKey);
    const fetchJwks = Object.assign(
      async (input: string | URL | Request) => new URL(
        input instanceof Request ? input.url : input.toString(),
      ).pathname === "/internal/jwks"
        ? Response.json({
            keys: [{ ...publicJwk, alg: "EdDSA", kid: "profile-test-key", use: "sig" }],
          })
        : Response.json({ client_id: "profile-test-client" }),
      { preconnect: originalFetch.preconnect },
    );
    spyOn(globalThis, "fetch").mockImplementation(fetchJwks);

    const repositories = [
      {} as PageRepository,
      {} as DirectoryRepository,
      {} as AssetRepository,
    ] as const;
    const knowledge = createMcpRequestHandler(...repositories);
    const knowledgeToken = await accessToken(config.MCP_RESOURCE, privateKey);
    const wrongAudienceToken = await accessToken(`${config.MCP_RESOURCE}/retired`, privateKey);

    const knowledgeResponse = await knowledge(toolListRequest(config.MCP_RESOURCE, knowledgeToken));
    expect(knowledgeResponse.status).toBe(200);

    const knowledgeTools = ((await knowledgeResponse.json()) as {
      result: { tools: Array<{ name: string }> };
    }).result.tools.map(({ name }) => name);
    expect(knowledgeTools).toContain("create_page");
    expect(knowledgeTools.some((name) => name.includes("automation"))).toBe(false);

    expect((await knowledge(toolListRequest(config.MCP_RESOURCE, wrongAudienceToken))).status).toBe(401);
  });

  test("rejects a signed MCP token when the auth service reports it inactive", async () => {
    const { publicKey, privateKey } = await generateKeyPair("EdDSA");
    const publicJwk = await exportJWK(publicKey);
    const fetchAuthorization = Object.assign(
      async (input: string | URL | Request) => new URL(
        input instanceof Request ? input.url : input.toString(),
      ).pathname === "/internal/jwks"
        ? Response.json({
            keys: [{ ...publicJwk, alg: "EdDSA", kid: "profile-test-key", use: "sig" }],
          })
        : new Response(null, { status: 401 }),
      { preconnect: originalFetch.preconnect },
    );
    spyOn(globalThis, "fetch").mockImplementation(fetchAuthorization);

    const knowledge = createMcpRequestHandler(
      {} as PageRepository,
      {} as DirectoryRepository,
      {} as AssetRepository,
    );
    const token = await accessToken(config.MCP_RESOURCE, privateKey);
    expect((await knowledge(toolListRequest(config.MCP_RESOURCE, token))).status).toBe(401);
  });
});
