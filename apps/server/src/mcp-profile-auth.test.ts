import { afterEach, describe, expect, spyOn, test } from "bun:test";
import type { AssetRepository, AutomationRepository, DirectoryRepository, PageRepository } from "@context-use/database";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { config, MCP_EXECUTION_RESOURCE } from "./config.ts";
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

describe("MCP profile audience binding", () => {
  test("knowledge and execution tokens cannot be exchanged between endpoints", async () => {
    const { publicKey, privateKey } = await generateKeyPair("EdDSA");
    const publicJwk = await exportJWK(publicKey);
    const fetchJwks = Object.assign(
      async () => Response.json({
        keys: [{ ...publicJwk, alg: "EdDSA", kid: "profile-test-key", use: "sig" }],
      }),
      { preconnect: originalFetch.preconnect },
    );
    spyOn(globalThis, "fetch").mockImplementation(fetchJwks);

    const repositories = [
      {} as PageRepository,
      {} as DirectoryRepository,
      {} as AssetRepository,
      {} as AutomationRepository,
    ] as const;
    const knowledge = createMcpRequestHandler("knowledge", ...repositories);
    const execution = createMcpRequestHandler("execution", ...repositories);
    const knowledgeToken = await accessToken(config.MCP_RESOURCE, privateKey);
    const executionToken = await accessToken(MCP_EXECUTION_RESOURCE, privateKey);

    const knowledgeResponse = await knowledge(toolListRequest(config.MCP_RESOURCE, knowledgeToken));
    const executionResponse = await execution(toolListRequest(MCP_EXECUTION_RESOURCE, executionToken));
    expect(knowledgeResponse.status).toBe(200);
    expect(executionResponse.status, await executionResponse.clone().text()).toBe(200);

    const knowledgeTools = ((await knowledgeResponse.json()) as {
      result: { tools: Array<{ name: string }> };
    }).result.tools.map(({ name }) => name);
    const executionTools = ((await executionResponse.json()) as {
      result: { tools: Array<{ name: string }> };
    }).result.tools.map(({ name }) => name);
    expect(knowledgeTools).toContain("create_page");
    expect(knowledgeTools).not.toContain("claim_due_run");
    expect(executionTools).toContain("claim_due_run");
    expect(executionTools).not.toContain("create_page");

    expect((await execution(toolListRequest(MCP_EXECUTION_RESOURCE, knowledgeToken))).status).toBe(401);
    expect((await knowledge(toolListRequest(config.MCP_RESOURCE, executionToken))).status).toBe(401);
  });
});
