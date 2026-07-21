import { describe, expect, test } from "bun:test";
import type { AssetRepository, AutomationRepository, PageRepository } from "@context-use/database";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { verifyAssetCapability } from "./mcp-asset-capability.ts";
import { createMcpServer, KNOWLEDGE_BASE_INSTRUCTIONS } from "./mcp-server.ts";
import { createStatelessMcpTransport } from "./mcp-transport.ts";

const skillVersionId = "22222222-2222-4222-8222-222222222222";

async function mcpRequest(server: McpServer, body: Record<string, unknown>) {
  const transport = createStatelessMcpTransport();
  await server.connect(transport);
  try {
    const response = await transport.handleRequest(new Request("https://example.com/mcp", {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": "2025-06-18",
      },
      body: JSON.stringify(body),
    }));
    return await response.json() as {
      result?: {
        tools?: Array<{
          name: string;
          description?: string;
          inputSchema?: { properties?: Record<string, { description?: string }> };
        }>;
        content?: Array<{ type: string; text: string }>;
        instructions?: string;
        isError?: boolean;
      };
    };
  } finally {
    await transport.close();
    await server.close();
  }
}

function serverWith(
  automations: AutomationRepository,
  pages = {} as PageRepository,
  assets = {} as AssetRepository,
) {
  return createMcpServer(
    { clientId: "mcp-client" },
    pages,
    assets,
    automations,
  );
}

describe("MCP skill and automation authoring", () => {
  test("gives clients the canonical knowledge structure during initialization", async () => {
    const response = await mcpRequest(serverWith({} as AutomationRepository), {
      jsonrpc: "2.0",
      id: 0,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" },
      },
    });

    expect(response.result?.instructions).toBe(KNOWLEDGE_BASE_INSTRUCTIONS);
    expect(response.result?.instructions).toContain("about/intro");
    expect(response.result?.instructions).toContain("AGENTS.md");
  });

  test("reads the root AGENTS.md guide through a dedicated discovery tool", async () => {
    const pages = {
      async getByPath(path: string) {
        expect(path).toBe("agents");
        return { current_path: "agents", title: "AGENTS.md", body_markdown: "Guide" };
      },
    } as unknown as PageRepository;
    const response = await mcpRequest(serverWith(
      {} as AutomationRepository,
      pages,
    ), {
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: { name: "get_knowledge_base_guide", arguments: {} },
    });

    expect(JSON.parse(response.result?.content?.[0]?.text ?? "null")).toMatchObject({
      current_path: "agents",
      title: "AGENTS.md",
    });
  });

  test("advertises progressive skill discovery and automation tools", async () => {
    const response = await mcpRequest(serverWith({} as AutomationRepository), {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    });

    expect(response.result?.tools?.map(({ name }) => name)).toEqual(expect.arrayContaining([
      "list_skills",
      "get_knowledge_base_guide",
      "get_skill",
      "create_skill",
      "create_automation",
      "create_automation_page",
      "create_asset_upload",
    ]));
    const createPage = response.result?.tools?.find(({ name }) => name === "create_page");
    expect(createPage?.description).toContain("body_markdown schema");
    expect(createPage?.inputSchema?.properties?.body_markdown?.description).toContain("layout=half");
    expect(response.result?.tools?.find(({ name }) => name === "update_page")?.description).toContain("automation-created page");
    expect(response.result?.tools?.find(({ name }) => name === "archive_page")?.description).toContain("created by an automation");
    expect(response.result?.tools?.find(({ name }) => name === "create_automation_page")?.description).toContain("private page");
    expect(response.result?.tools?.some(({ name }) => name.includes("publish"))).toBe(false);
    expect(response.result?.tools?.some(({ name }) => name === "get_markdown_guide")).toBe(false);
  });

  test("returns ready-to-paste formatting Markdown for image uploads", async () => {
    const assets = {
      async create() {
        return {
          id: "11111111-1111-4111-8111-111111111111",
          current_path: "photos/portrait",
          filename: "Portrait.jpg",
          content_type: "image/jpeg",
          size_bytes: 123,
          content_hash: "a".repeat(64),
          objectKey: "objects/secret-key",
        };
      },
    } as unknown as AssetRepository;
    const response = await mcpRequest(serverWith(
      {} as AutomationRepository,
      {} as PageRepository,
      assets,
    ), {
      jsonrpc: "2.0",
      id: 10,
      method: "tools/call",
      params: {
        name: "create_asset_upload",
        arguments: {
          path: "photos/portrait",
          filename: "Portrait.jpg",
          content_type: "image/jpeg",
          size_bytes: 123,
          sha256: "a".repeat(64),
        },
      },
    });

    const result = JSON.parse(response.result?.content?.[0]?.text ?? "null");
    expect(result.page_markdown.default).toBe("![Portrait.jpg](context-use://asset/11111111-1111-4111-8111-111111111111)");
    expect(result.page_markdown.formatted_example).toContain("{size=medium align=center shape=auto}");
    expect(result.page_markdown.help_tool).toBeUndefined();
  });

  test("creates checksum-bound asset uploads without exposing storage keys", async () => {
    const calls: unknown[] = [];
    const assets = {
      async create(input: unknown) {
        calls.push(input);
        return {
          id: "11111111-1111-4111-8111-111111111111",
          current_path: "documents/private-pdf",
          filename: "private.pdf",
          content_type: "application/pdf",
          size_bytes: 123,
          content_hash: "a".repeat(64),
          objectKey: "objects/secret-key",
        };
      },
    } as unknown as AssetRepository;
    const response = await mcpRequest(serverWith(
      {} as AutomationRepository,
      {} as PageRepository,
      assets,
    ), {
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        name: "create_asset_upload",
        arguments: {
          path: "documents/private-pdf",
          filename: "private.pdf",
          content_type: "application/pdf",
          size_bytes: 123,
          sha256: "a".repeat(64),
        },
      },
    });

    const result = JSON.parse(response.result?.content?.[0]?.text ?? "null");
    expect(calls).toEqual([{
      currentPath: "documents/private-pdf",
      filename: "private.pdf",
      contentType: "application/pdf",
      sizeBytes: 123,
      contentHash: "a".repeat(64),
    }]);
    expect(result.reference).toBe("context-use://asset/11111111-1111-4111-8111-111111111111");
    expect(result.upload).toMatchObject({
      method: "PUT",
      headers: { "content-type": "application/pdf", "content-length": "123" },
    });
    expect(typeof result.upload.headers["x-context-use-upload-token"]).toBe("string");
    expect(JSON.stringify(result)).not.toContain("secret-key");
  });

  test("returns an API-proxied asset download without exposing storage keys", async () => {
    const assets = {
      async get() {
        return {
          id: "11111111-1111-4111-8111-111111111111",
          current_path: "documents/private-pdf",
          filename: "private.pdf",
          content_type: "application/pdf",
          size_bytes: 123,
          content_hash: "a".repeat(64),
          s3_object_key: "objects/secret-key",
        };
      },
    } as unknown as AssetRepository;
    const response = await mcpRequest(serverWith(
      {} as AutomationRepository,
      {} as PageRepository,
      assets,
    ), {
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: {
        name: "get_asset",
        arguments: { asset_id: "11111111-1111-4111-8111-111111111111" },
      },
    });

    const result = JSON.parse(response.result?.content?.[0]?.text ?? "null");
    expect(result.download).toMatchObject({
      method: "GET",
      url: "http://localhost:3000/api/mcp/assets/11111111-1111-4111-8111-111111111111/content",
    });
    expect(verifyAssetCapability(result.download.headers["x-context-use-download-token"], "download")).toMatchObject({
      assetId: "11111111-1111-4111-8111-111111111111",
      action: "download",
    });
    expect(JSON.stringify(result)).not.toContain("secret-key");
    expect(JSON.stringify(result)).not.toContain("amazonaws");
  });

  test("creates independent skills and versioned automation instructions with MCP attribution", async () => {
    const calls: Array<{ operation: string; input: unknown; actor?: unknown }> = [];
    const automations = {
      async createSkill(input: unknown, actor: unknown) {
        calls.push({ operation: "skill", input, actor });
        return { id: "11111111-1111-4111-8111-111111111111", current_version_id: skillVersionId };
      },
      async createSchedule(input: unknown, actor: unknown) {
        calls.push({ operation: "schedule", input, actor });
        return { id: "33333333-3333-4333-8333-333333333333", ...input as object };
      },
    } as unknown as AutomationRepository;

    const skill = await mcpRequest(serverWith(automations), {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "create_skill",
        arguments: {
          name: "daily-review",
          description: "Reviews current project context. Use for a daily project health check.",
          instructions_markdown: "Review the current project and record decisions.",
          commit_message: "Create daily review skill",
        },
      },
    });
    expect(JSON.parse(skill.result?.content?.[0]?.text ?? "null")).toMatchObject({ current_version_id: skillVersionId });
    expect(calls[0]).toMatchObject({
      operation: "skill",
      actor: { kind: "mcp", subject: "mcp-client" },
    });

    const schedule = await mcpRequest(serverWith(automations), {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "create_automation",
        arguments: {
          name: "Weekday review",
          automation_key: "weekday-review",
          instructions_markdown: "Review the current project and record decisions.",
          cron_expression: "0 9 * * 1-5",
          timezone: "Europe/London",
        },
      },
    });
    expect(JSON.parse(schedule.result?.content?.[0]?.text ?? "null")).toMatchObject({
      instructions_markdown: "Review the current project and record decisions.",
    });
    expect(calls[1]).toMatchObject({
      operation: "schedule",
      input: {
        automation_key: "weekday-review",
        instructions_markdown: "Review the current project and record decisions.",
        commit_message: "Create automation",
        input: {},
        enabled: true,
      },
      actor: { kind: "mcp", subject: "mcp-client" },
    });
  });

  test("lists only skill discovery metadata", async () => {
    const automations = {
      async listSkills() {
        return [{
          id: "11111111-1111-4111-8111-111111111111",
          name: "daily-review",
          description: "Reviews context. Use for daily reviews.",
          current_version_id: skillVersionId,
          version_number: 2,
          instructions_markdown: "Sensitive full instructions",
          skill_markdown: "Full SKILL.md",
        }];
      },
    } as unknown as AutomationRepository;
    const response = await mcpRequest(serverWith(automations), {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "list_skills", arguments: {} },
    });
    const result = JSON.parse(response.result?.content?.[0]?.text ?? "null");
    expect(result).toEqual([{
      id: "11111111-1111-4111-8111-111111111111",
      name: "daily-review",
      description: "Reviews context. Use for daily reviews.",
      current_version_id: skillVersionId,
      version_number: 2,
    }]);
  });

  test("passes automation page writes through the run-scoped repository method", async () => {
    const calls: unknown[] = [];
    const pages = {
      async createForAutomation(input: unknown, actor: unknown) {
        calls.push({ input, actor });
        return { id: "44444444-4444-4444-8444-444444444444" };
      },
    } as unknown as PageRepository;
    const response = await mcpRequest(serverWith(
      {} as AutomationRepository,
      pages,
    ), {
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        name: "create_automation_page",
        arguments: {
          run_id: "55555555-5555-4555-8555-555555555555",
          claim_token: "66666666-6666-4666-8666-666666666666",
          relative_path: "reports/daily-review",
          title: "Daily review",
          body_markdown: "Review body",
          commit_message: "Create daily review",
        },
      },
    });
    expect(response.result?.isError).not.toBe(true);
    expect(calls).toEqual([{
      input: expect.objectContaining({ relative_path: "reports/daily-review" }),
      actor: { kind: "mcp", subject: "mcp-client" },
    }]);
  });

  test("accepts only concise automation completion summaries", async () => {
    const calls: string[] = [];
    const automations = {
      async completeRun(_runId: string, _claimToken: string, _clientId: string, summary?: string) {
        calls.push(summary ?? "");
        return { status: "succeeded", result_summary: summary };
      },
    } as unknown as AutomationRepository;
    const argumentsBase = {
      run_id: "55555555-5555-4555-8555-555555555555",
      claim_token: "66666666-6666-4666-8666-666666666666",
    };

    const concise = await mcpRequest(serverWith(automations), {
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: {
        name: "complete_run",
        arguments: { ...argumentsBase, result_summary: "Saved the digest to today's knowledge page." },
      },
    });
    expect(concise.result?.isError).not.toBe(true);
    expect(calls).toEqual(["Saved the digest to today's knowledge page."]);

    const verbose = await mcpRequest(serverWith(automations), {
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: {
        name: "complete_run",
        arguments: { ...argumentsBase, result_summary: "x".repeat(501) },
      },
    });
    expect(verbose.result?.isError).toBe(true);
    expect(calls).toHaveLength(1);
  });
});
