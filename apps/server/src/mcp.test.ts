import { describe, expect, test } from "bun:test";
import type { AssetRepository, AutomationRepository, DirectoryRepository, PageRepository } from "@context-use/database";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { verifyAssetCapability } from "./mcp-asset-capability.ts";
import { createMcpServer, KNOWLEDGE_BASE_INSTRUCTIONS, type McpProfile } from "./mcp-server.ts";
import { createStatelessMcpTransport } from "./mcp-transport.ts";

async function mcpRequest(serverOrPromise: McpServer | Promise<McpServer>, body: Record<string, unknown>) {
  const server = await serverOrPromise;
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
        structuredContent?: Record<string, unknown>;
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
  directories = {} as DirectoryRepository,
  profile: McpProfile = "knowledge",
) {
  return createMcpServer(
    { clientId: "mcp-client", profile },
    pages,
    directories,
    assets,
    automations,
  );
}

function executionServerWith(
  automations: AutomationRepository,
  pages = {} as PageRepository,
  assets = {} as AssetRepository,
  directories = {} as DirectoryRepository,
) {
  return serverWith(automations, pages, assets, directories, "execution");
}

describe("MCP knowledge and automation profiles", () => {
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

    expect(response.result?.instructions).toContain(KNOWLEDGE_BASE_INSTRUCTIONS);
    expect(response.result?.instructions).toContain("about/intro");
    expect(response.result?.instructions).toContain("AGENTS.md");
    expect(response.result?.instructions).toContain("Available reusable skills");
  });

  test("reads pages by semantic path and prepares applicable write guides", async () => {
    const pages = {
      async getByPath(path: string) {
        expect(path).toBe("agents");
        return { current_path: "agents", title: "AGENTS.md", body_markdown: "Guide" };
      },
      async guidesForPath(path: string) {
        expect(path).toBe("about/tasks/job-search/criteria");
        return [
          { current_path: "agents", title: "AGENTS.md", body_markdown: "Root guide" },
          { current_path: "about/tasks/job-search/agents", title: "AGENTS.md", body_markdown: "Local guide" },
        ];
      },
    } as unknown as PageRepository;
    const pageResponse = await mcpRequest(serverWith(
      {} as AutomationRepository,
      pages,
    ), {
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: { name: "get_page", arguments: { path: "agents" } },
    });

    expect(JSON.parse(pageResponse.result?.content?.[0]?.text ?? "null")).toMatchObject({
      current_path: "agents",
      title: "AGENTS.md",
    });

    const contextResponse = await mcpRequest(serverWith(
      {} as AutomationRepository,
      pages,
    ), {
      jsonrpc: "2.0",
      id: 10,
      method: "tools/call",
      params: {
        name: "prepare_knowledge_write",
        arguments: { target_path: "about/tasks/job-search/criteria" },
      },
    });
    expect(JSON.parse(contextResponse.result?.content?.[0]?.text ?? "null")).toMatchObject({
      target_path: "about/tasks/job-search/criteria",
      guides: [
        { current_path: "agents" },
        { current_path: "about/tasks/job-search/agents" },
      ],
    });
  });

  test("searches page bodies but returns metadata-only results", async () => {
    const pages = {
      async searchMetadata(query: string, options: { limit: number }) {
        expect({ query, options }).toEqual({
          query: "career direction",
          options: { limit: 12 },
        });
        return [{
          id: "11111111-1111-4111-8111-111111111111",
          current_path: "about/career/direction",
          current_version_id: "22222222-2222-4222-8222-222222222222",
          published_version_id: null,
          archived_at: null,
          version_number: 3,
          title: "Career direction",
          summary: "The owner's current criteria and career direction.",
          updated_at: "2026-07-28T12:00:00.000Z",
        }];
      },
    } as unknown as PageRepository;
    const response = await mcpRequest(serverWith({} as AutomationRepository, pages), {
      jsonrpc: "2.0",
      id: 14,
      method: "tools/call",
      params: {
        name: "search_pages",
        arguments: { query: "career direction", limit: 12 },
      },
    });
    const results = JSON.parse(response.result?.content?.[0]?.text ?? "null");
    expect(results).toMatchObject([{
      current_path: "about/career/direction",
      title: "Career direction",
    }]);
    expect(results[0]).not.toHaveProperty("body_markdown");
  });

  test("explores a generated directory index progressively", async () => {
    const directories = {
      async indexByPath(path: string) {
        expect(path).toBe("about/chapters");
        return {
          id: "11111111-1111-4111-8111-111111111111",
          current_path: path,
          title: "Chapters",
          summary: "The major chapters in the owner's life.",
          children: [{
            kind: "page",
            id: "22222222-2222-4222-8222-222222222222",
            path: "about/chapters/como",
            title: "Como",
            summary: "Growing up at the foot of the Alps.",
          }],
        };
      },
    } as unknown as DirectoryRepository;
    const response = await mcpRequest(serverWith(
      {} as AutomationRepository,
      {} as PageRepository,
      {} as AssetRepository,
      directories,
    ), {
      jsonrpc: "2.0",
      id: 10,
      method: "tools/call",
      params: { name: "get_directory", arguments: { path: "about/chapters" } },
    });
    expect(JSON.parse(response.result?.content?.[0]?.text ?? "null")).toMatchObject({
      reference: "context-use://directory/11111111-1111-4111-8111-111111111111",
      children: [{ title: "Como", summary: "Growing up at the foot of the Alps." }],
    });
  });

  test("browses nested page metadata with directory guides promoted separately", async () => {
    const directories = {
      async treeByPath(path: string, depth: number, maxPages: number) {
        expect({ path, depth, maxPages }).toEqual({
          path: "about",
          depth: 3,
          maxPages: 100,
        });
        return {
          id: "11111111-1111-4111-8111-111111111111",
          path,
          title: "About",
          summary: "Knowledge about the owner.",
          guide: {
            id: "22222222-2222-4222-8222-222222222222",
            path: "about/agents",
            version_number: 1,
            title: "AGENTS.md",
            summary: "Rules for owner knowledge.",
          },
          pages: [{
            id: "33333333-3333-4333-8333-333333333333",
            path: "about/intro",
            version_number: 2,
            title: "Introduction",
            summary: "A concise introduction to the owner.",
          }],
          directories: [{
            id: "44444444-4444-4444-8444-444444444444",
            path: "about/tasks",
            title: "Tasks",
            summary: "Current and historical efforts.",
            guide: null,
            pages: [],
            directories: [],
          }],
          requested_depth: depth,
          max_pages: maxPages,
          truncated: false,
        };
      },
    } as unknown as DirectoryRepository;
    const response = await mcpRequest(serverWith(
      {} as AutomationRepository,
      {} as PageRepository,
      {} as AssetRepository,
      directories,
    ), {
      jsonrpc: "2.0",
      id: 11,
      method: "tools/call",
      params: {
        name: "browse_directory",
        arguments: { path: "about", depth: 3, max_pages: 100 },
      },
    });
    expect(JSON.parse(response.result?.content?.[0]?.text ?? "null")).toMatchObject({
      path: "about",
      guide: { path: "about/agents", title: "AGENTS.md" },
      pages: [{ path: "about/intro", title: "Introduction" }],
      directories: [{ path: "about/tasks" }],
      truncated: false,
    });
    expect(response.result?.structuredContent).toMatchObject({
      path: "about",
      directories: [{ path: "about/tasks" }],
    });
  });

  test("advertises current skill summaries and loads a selected skill", async () => {
    const pages = {
      async metadataInDirectory(path: string) {
        expect(path).toBe("skills");
        return [
          {
            id: "11111111-1111-4111-8111-111111111111",
            path: "skills/job-search-review",
            version_number: 2,
            title: "SKILL.md",
            summary: "Evaluate roles against the owner's job-search criteria.",
          },
          {
            id: "22222222-2222-4222-8222-222222222222",
            path: "skills/agents",
            version_number: 1,
            title: "AGENTS.md",
            summary: "Rules for maintaining reusable skills.",
          },
        ];
      },
      async getByPath(path: string) {
        expect(path).toBe("skills/job-search-review");
        return {
          current_path: path,
          version_number: 2,
          title: "SKILL.md",
          summary: "Evaluate roles against the owner's job-search criteria.",
          body_markdown: "---\nname: job-search-review\n---\n\nReview the role.",
        };
      },
    } as unknown as PageRepository;
    const listed = await mcpRequest(serverWith({} as AutomationRepository, pages), {
      jsonrpc: "2.0",
      id: 12,
      method: "tools/list",
      params: {},
    });
    const loadSkill = listed.result?.tools?.find(({ name }) => name === "load_skill");
    expect(loadSkill?.description).toContain("job-search-review");
    expect(loadSkill?.description).toContain("Evaluate roles against");
    expect(loadSkill?.description).not.toContain("skills/agents");

    const loaded = await mcpRequest(serverWith({} as AutomationRepository, pages), {
      jsonrpc: "2.0",
      id: 13,
      method: "tools/call",
      params: { name: "load_skill", arguments: { name: "job-search-review" } },
    });
    expect(JSON.parse(loaded.result?.content?.[0]?.text ?? "null")).toMatchObject({
      current_path: "skills/job-search-review",
      title: "SKILL.md",
    });
  });

  test("separates ordinary knowledge tools from run-scoped execution tools", async () => {
    const knowledge = await mcpRequest(serverWith({} as AutomationRepository), {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    });
    const execution = await mcpRequest(executionServerWith({} as AutomationRepository), {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });

    const knowledgeTools = knowledge.result?.tools?.map(({ name }) => name) ?? [];
    const executionTools = execution.result?.tools?.map(({ name }) => name) ?? [];
    expect(knowledgeTools).toEqual(expect.arrayContaining([
      "get_directory",
      "browse_directory",
      "create_directory",
      "get_page",
      "prepare_knowledge_write",
      "load_skill",
      "create_page",
      "update_page",
      "create_asset_upload",
      "archive_asset",
      "create_automation",
    ]));
    expect(knowledgeTools).not.toEqual(expect.arrayContaining([
      "claim_due_run",
      "create_automation_page",
      "update_automation_page",
      "archive_automation_page",
      "complete_run",
      "fail_run",
    ]));
    expect(executionTools).toEqual(expect.arrayContaining([
      "get_directory",
      "browse_directory",
      "get_page",
      "prepare_knowledge_write",
      "load_skill",
      "claim_due_run",
      "create_automation_page",
      "update_automation_page",
      "archive_automation_page",
      "complete_run",
      "fail_run",
    ]));
    expect(executionTools).not.toEqual(expect.arrayContaining([
      "create_directory",
      "update_directory",
      "create_page",
      "update_page",
      "archive_page",
      "create_asset_upload",
      "archive_asset",
      "create_automation",
    ]));

    const createPage = knowledge.result?.tools?.find(({ name }) => name === "create_page");
    expect(createPage?.description).toContain("body_markdown schema");
    expect(createPage?.inputSchema?.properties?.body_markdown?.description).toContain("layout=half");
    expect(knowledge.result?.tools?.find(({ name }) => name === "update_page")?.description).toContain("automation-created page");
    expect(knowledge.result?.tools?.find(({ name }) => name === "update_page")?.description).toContain("prepare_knowledge_write");
    expect(knowledge.result?.tools?.find(({ name }) => name === "archive_page")?.description).toContain("created by an automation");
    expect(execution.result?.tools?.find(({ name }) => name === "create_automation_page")?.description).toContain("private page");
    expect(knowledgeTools.some((name) => name.includes("publish"))).toBe(false);
    expect(executionTools.some((name) => name.includes("publish"))).toBe(false);
    expect(knowledgeTools).not.toContain("list_pages");
    expect(knowledgeTools).not.toEqual(expect.arrayContaining([
      "list_skills",
      "get_skill",
      "create_skill",
    ]));
    expect(knowledgeTools).not.toContain("get_knowledge_base_guide");
    expect(knowledgeTools).not.toContain("get_markdown_guide");
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

  test("archives asset metadata without receiving a storage-delete capability", async () => {
    const calls: string[] = [];
    const assets = {
      async archive(assetId: string) {
        calls.push(assetId);
        return {
          id: assetId,
          current_path: "documents/private-pdf",
          filename: "private.pdf",
          deleted_at: "2026-07-28T18:00:00.000Z",
        };
      },
    } as unknown as AssetRepository;
    const response = await mcpRequest(serverWith(
      {} as AutomationRepository,
      {} as PageRepository,
      assets,
    ), {
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: {
        name: "archive_asset",
        arguments: { asset_id: "11111111-1111-4111-8111-111111111111" },
      },
    });

    expect(response.result?.isError).not.toBe(true);
    expect(calls).toEqual(["11111111-1111-4111-8111-111111111111"]);
    const result = JSON.parse(response.result?.content?.[0]?.text ?? "null");
    expect(result).toMatchObject({
      id: "11111111-1111-4111-8111-111111111111",
      current_path: "documents/private-pdf",
    });
    expect(result).not.toHaveProperty("s3_object_key");
    expect(result).not.toHaveProperty("delete");
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

  test("creates a page-backed skill with MCP attribution", async () => {
    const calls: Array<{ operation: string; input: unknown; actor?: unknown }> = [];
    const pages = {
      async create(input: unknown, actor: unknown) {
        calls.push({ operation: "page", input, actor });
        return { id: "11111111-1111-4111-8111-111111111111", ...input as object };
      },
    } as unknown as PageRepository;

    const skill = await mcpRequest(serverWith({} as AutomationRepository, pages), {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "create_page",
        arguments: {
          path: "skills/daily-review",
          title: "SKILL.md",
          summary: "A reusable skill for reviewing project context each day.",
          body_markdown: "---\nname: daily-review\ndescription: Reviews current project context. Use for a daily project health check.\n---\n\nReview the current project and record decisions.",
          commit_message: "Create daily review skill",
        },
      },
    });
    expect(JSON.parse(skill.result?.content?.[0]?.text ?? "null")).toMatchObject({
      path: "skills/daily-review",
      title: "SKILL.md",
    });
    expect(calls[0]).toMatchObject({
      operation: "page",
      input: {
        path: "skills/daily-review",
        title: "SKILL.md",
        summary: "A reusable skill for reviewing project context each day.",
        body_markdown: expect.stringContaining("name: daily-review"),
        commit_message: "Create daily review skill",
      },
      actor: { kind: "mcp", subject: "mcp-client" },
    });

    expect(calls).toHaveLength(1);
  });

  test("creates an automation through the knowledge profile with MCP attribution", async () => {
    const calls: Array<{ input: unknown; actor: unknown }> = [];
    const automations = {
      async createSchedule(input: unknown, actor: unknown) {
        calls.push({ input, actor });
        return { id: "33333333-3333-4333-8333-333333333333", ...input as object };
      },
    } as unknown as AutomationRepository;

    const response = await mcpRequest(serverWith(automations), {
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

    expect(response.result?.isError).not.toBe(true);
    expect(JSON.parse(response.result?.content?.[0]?.text ?? "null")).toMatchObject({
      automation_key: "weekday-review",
      instructions_markdown: "Review the current project and record decisions.",
    });
    expect(calls).toEqual([{
      input: {
        name: "Weekday review",
        automation_key: "weekday-review",
        instructions_markdown: "Review the current project and record decisions.",
        commit_message: "Create automation",
        cron_expression: "0 9 * * 1-5",
        timezone: "Europe/London",
        input: {},
        enabled: true,
        write_scope: [],
      },
      actor: { kind: "mcp", subject: "mcp-client" },
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
    const response = await mcpRequest(executionServerWith(
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
          path: "about/diary/2026/07/27/daily-review",
          title: "Daily review",
          summary: "The daily review produced by the automation.",
          body_markdown: "Review body",
          commit_message: "Create daily review",
        },
      },
    });
    expect(response.result?.isError).not.toBe(true);
    expect(calls).toEqual([{
      input: expect.objectContaining({ path: "about/diary/2026/07/27/daily-review" }),
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

    const concise = await mcpRequest(executionServerWith(automations), {
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

    const verbose = await mcpRequest(executionServerWith(automations), {
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
