import { describe, expect, test } from "bun:test";
import type {
  AssetRepository,
  DirectoryRepository,
  DocumentLinkRepository,
  KnowledgeSettingsRepository,
  PageRepository,
  SourceRecordRepository,
} from "@context-use/database";
import { DirectoryNotEmptyError } from "@context-use/database";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { verifyAssetCapability } from "./mcp-asset-capability.ts";
import {
  createGuidanceReceipt,
  verifyGuidanceReceipt,
  verifyKnowledgeGuideReceipt,
} from "./mcp-guidance-receipt.ts";
import { createMcpServer } from "./mcp-server.ts";
import { createStatelessMcpTransport } from "./mcp-transport.ts";
import type { SourceRecordReader } from "./nango-records.ts";

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
          annotations?: { readOnlyHint?: boolean };
          inputSchema?: { properties?: Record<string, { description?: string }> };
          outputSchema?: { properties?: Record<string, { description?: string }> };
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

const DEFAULT_MCP_CONTEXT = { clientId: "mcp-client", sessionId: "mcp-session" };

function serverWith(
  pages = {} as PageRepository,
  assets = {} as AssetRepository,
  directories = {} as DirectoryRepository,
  sourceRecords?: SourceRecordReader,
  options: {
    context?: { clientId: string; sessionId: string };
    recordDocuments?: SourceRecordRepository;
    knowledgeSettings?: KnowledgeSettingsRepository;
    documentLinks?: DocumentLinkRepository;
  } = {},
) {
  const knowledgeSettings = options.knowledgeSettings ?? {
    async globalGuide() {
      return {
        document_id: rootGuide.id,
        current_revision_id: rootGuide.current_version_id,
        revision_number: rootGuide.version_number,
        title: rootGuide.title,
        summary: "Test global guide.",
      };
    },
  } as KnowledgeSettingsRepository;
  return createMcpServer(
    options.context ?? DEFAULT_MCP_CONTEXT,
    pages,
    directories,
    assets,
    sourceRecords,
    options.recordDocuments,
    knowledgeSettings,
    options.documentLinks,
  );
}

const directoriesWith = (paths: string[] = []) => ({
  async getByPath(path: string) {
    return paths.includes(path) ? { id: "55555555-5555-4555-8555-555555555555" } : null;
  },
} as unknown as DirectoryRepository);

const rootGuide = {
  id: "11111111-1111-4111-8111-111111111111",
  current_path: "agents",
  current_version_id: "22222222-2222-4222-8222-222222222222",
  version_number: 1,
  title: "AGENTS.md",
  body_markdown: "Root guide",
};

function pagesWithGuidance(overrides: Record<string, unknown> = {}): PageRepository {
  return {
    async guidesForPath() {
      return [rootGuide];
    },
    ...overrides,
  } as unknown as PageRepository;
}

const rootGuidanceReceipt = createGuidanceReceipt([rootGuide], DEFAULT_MCP_CONTEXT);

type PreparedChangeResult = {
  target_path: string;
  guidance_receipt: string;
  guides: Array<{
    path: string;
    body_markdown?: string;
    reuse_from_previous_prepare_change?: true;
  }>;
  removed_guides?: string[];
};

function preparedChangeResult(response: {
  result?: { structuredContent?: Record<string, unknown> };
}): PreparedChangeResult {
  return response.result?.structuredContent as PreparedChangeResult;
}

describe("MCP knowledge tools", () => {
  test("exposes proactive selection at initialization and the change workflow entry point", async () => {
    const response = await mcpRequest(serverWith(), {
      jsonrpc: "2.0",
      id: 0,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" },
      },
    });
    expect(response.result?.instructions).toBe(
      "Use Context Use proactively when the user states a concrete durable fact, decision, "
        + "correction, relationship, plan, or completed activity about their life or work, "
        + "even if they do not explicitly say “remember.” Before the first knowledge mutation "
        + "in an authenticated session, call begin_knowledge_session, read its guide, and reuse "
        + "its receipt for targets without additional scoped guides. During the guidance "
        + "transition, call prepare_change for a target where scoped guides still apply.",
    );

    const listed = await mcpRequest(serverWith(), {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    });
    const prepare = listed.result?.tools?.find(({ name }) => name === "prepare_change");
    expect(prepare?.description).toStartWith("Transitional path-scoped guidance entry point");
    expect(prepare?.description).toContain("scoped AGENTS.md guides still apply");
    expect(prepare?.description).toContain("omit it to reload every guide after context loss or compaction");
    expect(prepare?.description).toContain("Never store receipts in knowledge");
  });

  test("loads the exact global guide once and binds its receipt to the guide revision and MCP session", async () => {
    const guideDocumentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const guideRevisionId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const guideMetadata = {
      document_id: guideDocumentId,
      current_revision_id: guideRevisionId,
      revision_number: 7,
      title: "Maintain the knowledge hypermedia",
      summary: "How agents maintain this workspace.",
    };
    const pages = {
      async metadataInDirectory() {
        return [];
      },
      async version(documentId: string, version: number) {
        expect([documentId, version]).toEqual([guideDocumentId, 7]);
        return { id: guideRevisionId, body_markdown: "# Exact global guide\n\nRead all of me." };
      },
    } as unknown as PageRepository;
    const knowledgeSettings = {
      async globalGuide() {
        return guideMetadata;
      },
    } as unknown as KnowledgeSettingsRepository;
    const response = await mcpRequest(serverWith(
      pages,
      {} as AssetRepository,
      {} as DirectoryRepository,
      undefined,
      { knowledgeSettings },
    ), {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "begin_knowledge_session", arguments: {} },
    });
    const session = response.result?.structuredContent as {
      document_id: string;
      revision_id: string;
      revision_number: number;
      title: string;
      summary: string;
      body_markdown: string;
      knowledge_session_receipt: string;
    };
    expect(session).toMatchObject({
      document_id: guideDocumentId,
      revision_id: guideRevisionId,
      revision_number: 7,
      title: "Maintain the knowledge hypermedia",
      summary: "How agents maintain this workspace.",
      body_markdown: "# Exact global guide\n\nRead all of me.",
    });
    expect(verifyKnowledgeGuideReceipt(session.knowledge_session_receipt, {
      documentId: guideDocumentId,
      revisionId: guideRevisionId,
    }, { clientId: "mcp-client", sessionId: "mcp-session" })).toBe(true);
  });

  test("reuses a session receipt across unscoped targets and rejects it before writes in another session or after a guide change", async () => {
    const guideDocumentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const originalRevisionId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    let currentRevisionId = originalRevisionId;
    const knowledgeSettings = {
      async globalGuide() {
        return {
          document_id: guideDocumentId,
          current_revision_id: currentRevisionId,
          revision_number: currentRevisionId === originalRevisionId ? 1 : 2,
          title: "Guide",
          summary: "Global guidance.",
        };
      },
    } as unknown as KnowledgeSettingsRepository;
    const writes: string[] = [];
    const pages = {
      async metadataInDirectory() {
        return [];
      },
      async version() {
        return { id: originalRevisionId, body_markdown: "# Guide" };
      },
      async guidesForPath() {
        return [{
          ...rootGuide,
          id: guideDocumentId,
          current_version_id: currentRevisionId,
        }];
      },
      async create(input: { path: string }) {
        writes.push(input.path);
        return {
          id: crypto.randomUUID(),
          current_path: input.path,
          current_version_id: crypto.randomUUID(),
          version_number: 1,
          title: "Created",
          summary: "Created page.",
          body_markdown: "Created.",
          published_version_id: null,
          published_version_number: null,
          public_path: null,
        };
      },
    } as unknown as PageRepository;
    const begin = await mcpRequest(serverWith(
      pages,
      {} as AssetRepository,
      {} as DirectoryRepository,
      undefined,
      { knowledgeSettings },
    ), {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "begin_knowledge_session", arguments: {} },
    });
    const receipt = (begin.result?.structuredContent as { knowledge_session_receipt: string })
      .knowledge_session_receipt;
    const create = (path: string, context?: { clientId: string; sessionId: string }) => mcpRequest(
      serverWith(
        pages,
        {} as AssetRepository,
        {} as DirectoryRepository,
        undefined,
        { knowledgeSettings, ...(context ? { context } : {}) },
      ),
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "create_page",
          arguments: {
            path,
            title: "Created",
            summary: "Created page.",
            body_markdown: "Created.",
            commit_message: "Create page",
            knowledge_session_receipt: receipt,
          },
        },
      },
    );

    expect((await create("first/page")).result?.isError).not.toBe(true);
    expect((await create("second/page")).result?.isError).not.toBe(true);
    expect(writes).toEqual(["first/page", "second/page"]);

    const wrongSession = await create("blocked/session", {
      clientId: "mcp-client",
      sessionId: "another-session",
    });
    expect(wrongSession.result?.isError).toBe(true);
    expect(writes).toHaveLength(2);

    currentRevisionId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const stale = await create("blocked/stale");
    expect(stale.result?.isError).toBe(true);
    expect(writes).toHaveLength(2);
  });

  test("requires the exact configured global guide in scoped chains and preserves scoped guidance during transition", async () => {
    const globalGuide = {
      ...rootGuide,
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      current_version_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      body_markdown: "# Global guide",
    };
    const scopedGuide = {
      ...rootGuide,
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      current_path: "scoped/agents",
      current_version_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      body_markdown: "# Scoped guide",
    };
    type ConfiguredGuide = {
      document_id: string;
      current_revision_id: string;
      revision_number: number;
      title: string;
      summary: string;
    };
    const exactConfiguredGuide: ConfiguredGuide = {
      document_id: globalGuide.id,
      current_revision_id: globalGuide.current_version_id,
      revision_number: 1,
      title: "Global guide",
      summary: "Global maintenance guidance.",
    };
    let configuredGuide: ConfiguredGuide | null = exactConfiguredGuide;
    const knowledgeSettings = {
      async globalGuide() {
        return configuredGuide;
      },
    } as unknown as KnowledgeSettingsRepository;
    const writes: string[] = [];
    const pages = {
      async metadataInDirectory() {
        return [];
      },
      async version() {
        return {
          id: globalGuide.current_version_id,
          body_markdown: globalGuide.body_markdown,
        };
      },
      async guidesForPath(path: string) {
        return path.startsWith("scoped/")
          ? [globalGuide, scopedGuide]
          : [globalGuide];
      },
      async create(input: { path: string }) {
        writes.push(input.path);
        return {
          id: crypto.randomUUID(),
          current_path: input.path,
          current_version_id: crypto.randomUUID(),
          version_number: 1,
          title: "Created",
          summary: "Created page.",
          body_markdown: "Created.",
          published_version_id: null,
          published_version_number: null,
          public_path: null,
        };
      },
    } as unknown as PageRepository;
    const callWithContext = (
      context: { clientId: string; sessionId: string },
      name: string,
      args: Record<string, unknown>,
      id: number,
    ) => mcpRequest(serverWith(
      pages,
      {} as AssetRepository,
      {} as DirectoryRepository,
      undefined,
      { knowledgeSettings, context },
    ), {
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name, arguments: args },
    });
    const call = (name: string, args: Record<string, unknown>, id: number) => callWithContext(
      DEFAULT_MCP_CONTEXT,
      name,
      args,
      id,
    );
    const pageInput = (path: string) => ({
      path,
      title: "Created",
      summary: "Created page.",
      body_markdown: "Created.",
      commit_message: "Create page",
    });

    const begin = await call("begin_knowledge_session", {}, 30);
    const sessionReceipt = (begin.result?.structuredContent as {
      knowledge_session_receipt: string;
    }).knowledge_session_receipt;
    const scopedWithGlobalReceipt = await call("create_page", {
      ...pageInput("scoped/session-receipt"),
      knowledge_session_receipt: sessionReceipt,
    }, 31);
    expect(scopedWithGlobalReceipt.result?.isError).toBe(true);
    expect(scopedWithGlobalReceipt.result?.content?.[0]?.text).toContain("prepare_change");
    expect(writes).toEqual([]);

    const prepared = await call("prepare_change", { target_path: "scoped/legacy" }, 32);
    expect(prepared.result?.isError).not.toBe(true);
    const guidanceReceipt = preparedChangeResult(prepared).guidance_receipt;
    expect(verifyGuidanceReceipt(
      guidanceReceipt,
      [globalGuide, scopedGuide],
      DEFAULT_MCP_CONTEXT,
    )).toBe(true);
    const scopedWithChainReceipt = await call("create_page", {
      ...pageInput("scoped/legacy"),
      guidance_receipt: guidanceReceipt,
    }, 33);
    expect(scopedWithChainReceipt.result?.isError).not.toBe(true);
    expect(writes).toEqual(["scoped/legacy"]);

    const crossSession = await callWithContext({
      ...DEFAULT_MCP_CONTEXT,
      sessionId: "another-session",
    }, "create_page", {
      ...pageInput("scoped/cross-session"),
      guidance_receipt: guidanceReceipt,
    }, 331);
    expect(crossSession.result?.isError).toBe(true);
    const crossClient = await callWithContext({
      ...DEFAULT_MCP_CONTEXT,
      clientId: "another-client",
    }, "create_page", {
      ...pageInput("scoped/cross-client"),
      guidance_receipt: guidanceReceipt,
    }, 332);
    expect(crossClient.result?.isError).toBe(true);
    expect(writes).toEqual(["scoped/legacy"]);

    configuredGuide = {
      ...exactConfiguredGuide,
      document_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    };
    const wrongDocument = await call("prepare_change", { target_path: "scoped/blocked" }, 34);
    expect(wrongDocument.result?.isError).toBe(true);
    expect(wrongDocument.result?.content?.[0]?.text).toStartWith("KNOWLEDGE_GUIDE_UNAVAILABLE");
    const blockedChainReceipt = await call("create_page", {
      ...pageInput("scoped/blocked"),
      guidance_receipt: guidanceReceipt,
    }, 35);
    expect(blockedChainReceipt.result?.isError).toBe(true);
    expect(writes).toEqual(["scoped/legacy"]);

    configuredGuide = {
      ...exactConfiguredGuide,
      current_revision_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    };
    const wrongRevision = await call("prepare_change", { target_path: "scoped/blocked" }, 36);
    expect(wrongRevision.result?.isError).toBe(true);
    configuredGuide = null;
    const unavailable = await call("prepare_change", { target_path: "scoped/blocked" }, 37);
    expect(unavailable.result?.isError).toBe(true);
  });

  test("requires one receipt to authorize both sides of a page move during scoped-guide transition", async () => {
    const globalGuide = {
      ...rootGuide,
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      current_version_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    };
    const scopeAGuide = {
      ...rootGuide,
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      current_path: "scope-a/agents",
      current_version_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    };
    const scopeBGuide = {
      ...rootGuide,
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      current_path: "scope-b/agents",
      current_version_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    };
    const pageId = "12121212-1212-4212-8212-121212121212";
    const updates: unknown[] = [];
    const pages = {
      async version() {
        return { id: globalGuide.current_version_id, body_markdown: "# Global guide" };
      },
      async guidesForPath(path: string) {
        if (path.startsWith("scope-a/")) return [globalGuide, scopeAGuide];
        if (path.startsWith("scope-b/")) return [globalGuide, scopeBGuide];
        return [globalGuide];
      },
      async get(id: string) {
        expect(id).toBe(pageId);
        return {
          id: pageId,
          current_path: "scope-a/original",
          current_version_id: "34343434-3434-4434-8434-343434343434",
          version_number: 1,
          title: "Original",
          summary: "Original page.",
          body_markdown: "Original.",
          published_version_id: null,
          published_version_number: null,
          public_path: null,
        };
      },
      async update(...args: unknown[]) {
        updates.push(args);
        return null;
      },
    } as unknown as PageRepository;
    const knowledgeSettings = {
      async globalGuide() {
        return {
          document_id: globalGuide.id,
          current_revision_id: globalGuide.current_version_id,
          revision_number: 1,
          title: "Global guide",
          summary: "Global guidance.",
        };
      },
    } as unknown as KnowledgeSettingsRepository;
    const call = (name: string, args: Record<string, unknown>, id: number) => mcpRequest(serverWith(
      pages,
      {} as AssetRepository,
      {} as DirectoryRepository,
      undefined,
      { knowledgeSettings },
    ), {
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name, arguments: args },
    });
    const updateInput = (path: string) => ({
      page_id: pageId,
      path,
      title: "Moved",
      summary: "Moved page.",
      body_markdown: "Moved.",
      commit_message: "Move page",
      expected_version_number: 1,
    });

    const begin = await call("begin_knowledge_session", {}, 38);
    const sessionReceipt = (begin.result?.structuredContent as {
      knowledge_session_receipt: string;
    }).knowledge_session_receipt;
    const scopedToUnscoped = await call("update_page", {
      ...updateInput("unscoped/moved"),
      knowledge_session_receipt: sessionReceipt,
    }, 39);
    expect(scopedToUnscoped.result?.isError).toBe(true);
    expect(scopedToUnscoped.result?.content?.[0]?.text).toContain("scope-a/original");

    const targetPreparation = await call("prepare_change", { target_path: "scope-b/moved" }, 40);
    const targetReceipt = preparedChangeResult(targetPreparation).guidance_receipt;
    expect(verifyGuidanceReceipt(
      targetReceipt,
      [globalGuide, scopeBGuide],
      DEFAULT_MCP_CONTEXT,
    )).toBe(true);
    const scopedToOtherScope = await call("update_page", {
      ...updateInput("scope-b/moved"),
      guidance_receipt: targetReceipt,
    }, 41);
    expect(scopedToOtherScope.result?.isError).toBe(true);
    expect(scopedToOtherScope.result?.content?.[0]?.text).toContain("scope-a/original");
    expect(updates).toEqual([]);
  });

  test("exposes one unified checkpointed source reader when Nango access is configured", async () => {
    const calls: unknown[] = [];
    const sourceRecords = {
      async read(input: unknown) {
        calls.push(input);
        return {
          records: [{
            action: "added" as const,
            markdown: "# Pull request\n\nImplemented the record pipeline.",
          }],
          next_checkpoint: "cu-nango-v1.opaque",
          has_more: false,
        };
      },
    } as SourceRecordReader;
    const listed = await mcpRequest(serverWith(
      {} as PageRepository,
      {} as AssetRepository,
      {} as DirectoryRepository,
      sourceRecords,
    ), {
      jsonrpc: "2.0",
      id: 21,
      method: "tools/list",
      params: {},
    });
    const tool = listed.result?.tools?.find(({ name }) => name === "read_source_records");
    expect(tool?.description).toContain("bounded, checkpointed working set");
    expect(tool?.description).toContain("more than 30 days old");
    expect(tool?.description).toContain("added, updated, or deleted action");
    expect(tool?.description).toContain("Context from immediately before this excerpt");
    expect(tool?.description).toContain("not as new activity");
    expect(tool?.description).toContain("persist next_checkpoint only after its writes succeed");
    expect(tool?.description).toContain("end the run without reading another working set");
    expect(tool?.description).toContain("next fresh run has more source work");
    expect(tool?.annotations?.readOnlyHint).toBe(false);
    expect(tool?.inputSchema?.properties?.max_bytes).toBeUndefined();

    const read = await mcpRequest(serverWith(
      {} as PageRepository,
      {} as AssetRepository,
      {} as DirectoryRepository,
      sourceRecords,
    ), {
      jsonrpc: "2.0",
      id: 22,
      method: "tools/call",
      params: {
        name: "read_source_records",
        arguments: { checkpoint: "cu-nango-v1.previous", limit: 25 },
      },
    });
    expect(read.result?.isError).not.toBe(true);
    expect(read.result?.structuredContent).toMatchObject({
      records: [{ action: "added", markdown: expect.stringContaining("record pipeline") }],
      next_checkpoint: "cu-nango-v1.opaque",
      has_more: false,
    });
    expect(read.result?.structuredContent?.batch_bytes).toBeUndefined();
    expect(calls).toEqual([{ checkpoint: "cu-nango-v1.previous", limit: 25 }]);
  });

  test("searches and reads private records as first-class hypermedia without exposing object keys", async () => {
    const documentId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const revisionId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const tombstoneId = "abababab-abab-4bab-8bab-abababababab";
    const metadata = {
      document_id: documentId,
      current_revision_id: revisionId,
      reference: `context-use://document/${documentId}`,
      revision_number: 3,
      integration: "github",
      connection_id: "owner",
      model: "pull-request",
      source_record_id: "pr-42",
      source_created_at: new Date("2026-01-01T00:00:00.000Z"),
      source_updated_at: new Date("2026-01-02T00:00:00.000Z"),
      deleted_at: null,
      created_at: new Date("2026-01-01T00:00:00.000Z"),
      updated_at: new Date("2026-01-02T00:00:00.000Z"),
    };
    const calls: unknown[] = [];
    const recordDocuments = {
      async searchMetadata(query: string, options: unknown) {
        calls.push(["search", query, options]);
        return [metadata];
      },
      async get(id: string) {
        calls.push(["get", id]);
        if (id === tombstoneId) {
          return {
            ...metadata,
            document_id: tombstoneId,
            current_revision_id: null,
            revision_number: null,
            reference: `context-use://document/${tombstoneId}`,
            deleted_at: new Date("2026-01-04T00:00:00.000Z"),
            body_markdown: null,
          };
        }
        return { ...metadata, body_markdown: "# Pull request 42\n\nMerged." };
      },
    } as unknown as SourceRecordRepository;
    const documentLinks = {
      async revisionIndex(id: string) {
        calls.push(["index", id]);
        return {
          source_revision_id: id,
          links_indexed_at: new Date("2026-01-02T00:00:00.000Z"),
          target_document_ids: ["ffffffff-ffff-4fff-8fff-ffffffffffff"],
        };
      },
      async backlinks(id: string, limit: number) {
        calls.push(["backlinks", id, limit]);
        return {
          backlinks: [{
            source_document_id: "99999999-9999-4999-8999-999999999999",
            source_revision_id: "88888888-8888-4888-8888-888888888888",
            source_revision_number: 4,
            source_authority: "knowledge" as const,
            source_representation: "markdown" as const,
            links_indexed_at: new Date("2026-01-03T00:00:00.000Z"),
          }],
          has_more: false,
        };
      },
      async backlinksComplete() {
        calls.push(["complete"]);
        return true;
      },
    } as unknown as DocumentLinkRepository;
    const options = { recordDocuments, documentLinks };

    const listed = await mcpRequest(serverWith(
      {} as PageRepository,
      {} as AssetRepository,
      {} as DirectoryRepository,
      undefined,
      options,
    ), {
      jsonrpc: "2.0",
      id: 23,
      method: "tools/list",
      params: {},
    });
    const readTool = listed.result?.tools?.find(({ name }) => name === "read_record");
    expect(readTool?.inputSchema?.properties).toHaveProperty("document_id");
    expect(readTool?.inputSchema?.properties).not.toHaveProperty("record_id");
    expect(readTool?.inputSchema?.properties).not.toHaveProperty("path");
    expect(readTool?.description).toContain("backlinks_has_more only reports pagination");
    expect(readTool?.description).toContain("backlinks_complete");
    expect(listed.result?.tools?.find(({ name }) => name === "search_records")?.description)
      .toContain("cannot be published");

    const searched = await mcpRequest(serverWith(
      {} as PageRepository,
      {} as AssetRepository,
      {} as DirectoryRepository,
      undefined,
      options,
    ), {
      jsonrpc: "2.0",
      id: 24,
      method: "tools/call",
      params: { name: "search_records", arguments: { query: "merged", limit: 5 } },
    });
    const searchText = searched.result?.content?.[0]?.text ?? "";
    expect(searchText).toContain(`context-use://document/${documentId}`);
    expect(searchText).not.toContain("body_markdown");
    expect(searchText).not.toContain("object_key");

    const read = await mcpRequest(serverWith(
      {} as PageRepository,
      {} as AssetRepository,
      {} as DirectoryRepository,
      undefined,
      options,
    ), {
      jsonrpc: "2.0",
      id: 25,
      method: "tools/call",
      params: { name: "read_record", arguments: { document_id: documentId } },
    });
    const record = JSON.parse(read.result?.content?.[0]?.text ?? "null");
    expect(record).toMatchObject({
      document_id: documentId,
      current_revision_id: revisionId,
      reference: `context-use://document/${documentId}`,
      body_markdown: expect.stringContaining("Merged"),
      hypermedia: {
        links_indexed: true,
        outbound_document_ids: ["ffffffff-ffff-4fff-8fff-ffffffffffff"],
        backlinks: [{
          source_document_id: "99999999-9999-4999-8999-999999999999",
          source_authority: "knowledge",
          source_representation: "markdown",
        }],
        backlinks_has_more: false,
        backlinks_complete: true,
      },
    });
    expect(JSON.stringify(record)).not.toContain("object_key");

    const tombstoneRead = await mcpRequest(serverWith(
      {} as PageRepository,
      {} as AssetRepository,
      {} as DirectoryRepository,
      undefined,
      options,
    ), {
      jsonrpc: "2.0",
      id: 27,
      method: "tools/call",
      params: { name: "read_record", arguments: { document_id: tombstoneId } },
    });
    const tombstone = JSON.parse(tombstoneRead.result?.content?.[0]?.text ?? "null");
    expect(tombstone).toMatchObject({
      document_id: tombstoneId,
      current_revision_id: null,
      body_markdown: null,
      hypermedia: {
        links_indexed: true,
        outbound_document_ids: [],
      },
    });
    expect(calls).toEqual(expect.arrayContaining([
      ["search", "merged", { limit: 5 }],
      ["get", documentId],
      ["index", revisionId],
      ["backlinks", documentId, 100],
      ["complete"],
      ["get", tombstoneId],
      ["backlinks", tombstoneId, 100],
    ]));
  });

  test("reads pages by semantic path and prepares applicable change guides", async () => {
    const guides = [
      rootGuide,
      {
        id: "33333333-3333-4333-8333-333333333333",
        current_path: "about/tasks/job-search/agents",
        current_version_id: "44444444-4444-4444-8444-444444444444",
        version_number: 2,
        title: "AGENTS.md",
        body_markdown: "Local guide",
      },
    ];
    const pages = {
      async getByPath(path: string) {
        expect(path).toBe("agents");
        return { current_path: "agents", title: "AGENTS.md", body_markdown: "Guide" };
      },
      async guidesForPath(path: string) {
        expect(path).toBe("about/tasks/job-search/criteria");
        return guides;
      },
    } as unknown as PageRepository;
    const pageResponse = await mcpRequest(serverWith(pages), {
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: { name: "read_page", arguments: { path: "agents" } },
    });

    expect(JSON.parse(pageResponse.result?.content?.[0]?.text ?? "null")).toMatchObject({
      current_path: "agents",
      title: "AGENTS.md",
      hypermedia: {
        links_indexed: false,
        outbound_document_ids: [],
        backlinks: [],
        backlinks_has_more: false,
        backlinks_complete: false,
      },
    });

    const contextResponse = await mcpRequest(serverWith(pages), {
      jsonrpc: "2.0",
      id: 10,
      method: "tools/call",
      params: {
        name: "prepare_change",
        arguments: { target_path: "about/tasks/job-search/criteria" },
      },
    });
    const prepared = preparedChangeResult(contextResponse);
    expect(prepared).toMatchObject({
      target_path: "about/tasks/job-search/criteria",
      guides: [
        { path: "agents", body_markdown: "Root guide" },
        { path: "about/tasks/job-search/agents", body_markdown: "Local guide" },
      ],
    });
    expect(verifyGuidanceReceipt(
      prepared.guidance_receipt,
      guides,
      DEFAULT_MCP_CONTEXT,
    )).toBe(true);
    expect(JSON.parse(contextResponse.result?.content?.[0]?.text ?? "null")).toEqual(prepared);
  });

  test("reads a page with its current outbound links and live backlinks", async () => {
    const documentId = "12121212-1212-4212-8212-121212121212";
    const revisionId = "34343434-3434-4434-8434-343434343434";
    const pages = {
      async get(id: string) {
        expect(id).toBe(documentId);
        return {
          id: documentId,
          current_path: "notes/linked",
          current_version_id: revisionId,
          version_number: 2,
          title: "Linked note",
          summary: "A note in the graph.",
          body_markdown: "See another document.",
          published_version_id: null,
          published_version_number: null,
          public_path: null,
        };
      },
    } as unknown as PageRepository;
    const documentLinks = {
      async revisionIndex(id: string) {
        expect(id).toBe(revisionId);
        return {
          source_revision_id: revisionId,
          links_indexed_at: new Date("2026-01-02T00:00:00.000Z"),
          target_document_ids: ["56565656-5656-4656-8656-565656565656"],
        };
      },
      async backlinks(id: string, limit: number) {
        expect(id).toBe(documentId);
        expect(limit).toBe(100);
        return {
          backlinks: [{
            source_document_id: "78787878-7878-4878-8878-787878787878",
            source_revision_id: "90909090-9090-4090-8090-909090909090",
            source_revision_number: 5,
            source_authority: "source" as const,
            source_representation: "markdown" as const,
            links_indexed_at: new Date("2026-01-03T00:00:00.000Z"),
          }],
          has_more: true,
        };
      },
      async backlinksComplete() {
        return false;
      },
    } as unknown as DocumentLinkRepository;
    const response = await mcpRequest(serverWith(
      pages,
      {} as AssetRepository,
      {} as DirectoryRepository,
      undefined,
      { documentLinks },
    ), {
      jsonrpc: "2.0",
      id: 26,
      method: "tools/call",
      params: { name: "read_page", arguments: { page_id: documentId } },
    });
    expect(JSON.parse(response.result?.content?.[0]?.text ?? "null")).toMatchObject({
      id: documentId,
      hypermedia: {
        links_indexed: true,
        outbound_document_ids: ["56565656-5656-4656-8656-565656565656"],
        backlinks: [{
          source_document_id: "78787878-7878-4878-8878-787878787878",
          source_revision_id: "90909090-9090-4090-8090-909090909090",
          source_revision_number: 5,
          source_authority: "source",
          source_representation: "markdown",
        }],
        backlinks_has_more: true,
        backlinks_complete: false,
      },
    });
  });

  test("prepares only guidance deltas when moving between instruction scopes", async () => {
    const aboutGuide = {
      ...rootGuide,
      id: "33333333-3333-4333-8333-333333333333",
      current_path: "about/agents",
      current_version_id: "44444444-4444-4444-8444-444444444444",
      body_markdown: "Unique about instructions body",
    };
    const tasksGuide = {
      ...rootGuide,
      id: "55555555-5555-4555-8555-555555555555",
      current_path: "about/tasks/agents",
      current_version_id: "66666666-6666-4666-8666-666666666666",
      body_markdown: "Unique task instructions body",
    };
    const placesGuide = {
      ...rootGuide,
      id: "77777777-7777-4777-8777-777777777777",
      current_path: "places/agents",
      current_version_id: "88888888-8888-4888-8888-888888888888",
      body_markdown: "Unique place instructions body",
    };
    const rootWithUniqueBody = { ...rootGuide, body_markdown: "Unique root instructions body" };
    const pages = {
      async guidesForPath(path: string) {
        if (path.startsWith("about/tasks/")) return [rootWithUniqueBody, aboutGuide, tasksGuide];
        if (path.startsWith("about/")) return [rootWithUniqueBody, aboutGuide];
        if (path.startsWith("places/")) return [rootWithUniqueBody, placesGuide];
        return [rootWithUniqueBody];
      },
    } as unknown as PageRepository;

    const aboutPreparation = await mcpRequest(serverWith(pages), {
      jsonrpc: "2.0",
      id: 40,
      method: "tools/call",
      params: {
        name: "prepare_change",
        arguments: { target_path: "about/profile" },
      },
    });
    const aboutPrepared = preparedChangeResult(aboutPreparation);
    const aboutReceipt = aboutPrepared.guidance_receipt;
    expect(aboutPrepared.guides).toEqual([
      { path: "agents", body_markdown: "Unique root instructions body" },
      { path: "about/agents", body_markdown: "Unique about instructions body" },
    ]);

    const tasksPreparation = await mcpRequest(serverWith(pages), {
      jsonrpc: "2.0",
      id: 41,
      method: "tools/call",
      params: {
        name: "prepare_change",
        arguments: {
          target_path: "about/tasks/daily-review",
          cached_guidance_receipt: aboutReceipt,
        },
      },
    });
    const tasksPrepared = preparedChangeResult(tasksPreparation);
    const tasksReceipt = tasksPrepared.guidance_receipt;
    expect(tasksPrepared.guides).toEqual([
      { path: "agents", reuse_from_previous_prepare_change: true },
      { path: "about/agents", reuse_from_previous_prepare_change: true },
      { path: "about/tasks/agents", body_markdown: "Unique task instructions body" },
    ]);
    expect(verifyGuidanceReceipt(
      tasksReceipt,
      [rootWithUniqueBody, aboutGuide, tasksGuide],
      DEFAULT_MCP_CONTEXT,
    )).toBe(true);

    const crossSessionPreparation = await mcpRequest(serverWith(
      pages,
      {} as AssetRepository,
      {} as DirectoryRepository,
      undefined,
      { context: { ...DEFAULT_MCP_CONTEXT, sessionId: "another-session" } },
    ), {
      jsonrpc: "2.0",
      id: 411,
      method: "tools/call",
      params: {
        name: "prepare_change",
        arguments: {
          target_path: "about/tasks/daily-review",
          cached_guidance_receipt: tasksReceipt,
        },
      },
    });
    expect(preparedChangeResult(crossSessionPreparation).guides).toEqual([
      { path: "agents", body_markdown: "Unique root instructions body" },
      { path: "about/agents", body_markdown: "Unique about instructions body" },
      { path: "about/tasks/agents", body_markdown: "Unique task instructions body" },
    ]);

    const placesPreparation = await mcpRequest(serverWith(pages), {
      jsonrpc: "2.0",
      id: 42,
      method: "tools/call",
      params: {
        name: "prepare_change",
        arguments: {
          target_path: "places/london",
          cached_guidance_receipt: tasksReceipt,
        },
      },
    });
    const placesPrepared = preparedChangeResult(placesPreparation);
    expect(placesPrepared.guides).toEqual([
      { path: "agents", reuse_from_previous_prepare_change: true },
      { path: "places/agents", body_markdown: "Unique place instructions body" },
    ]);
    expect(placesPrepared.removed_guides).toEqual([
      "about/agents",
      "about/tasks/agents",
    ]);

    const reloaded = await mcpRequest(serverWith(pages), {
      jsonrpc: "2.0",
      id: 43,
      method: "tools/call",
      params: {
        name: "prepare_change",
        arguments: { target_path: "about/tasks/daily-review" },
      },
    });
    expect(preparedChangeResult(reloaded).guides).toEqual([
      { path: "agents", body_markdown: "Unique root instructions body" },
      { path: "about/agents", body_markdown: "Unique about instructions body" },
      { path: "about/tasks/agents", body_markdown: "Unique task instructions body" },
    ]);
  });

  test("directs a mutation without current guidance to the exact preparation call", async () => {
    const calls: unknown[] = [];
    const pages = pagesWithGuidance({
      async create(input: unknown) {
        calls.push(input);
        return input;
      },
    });
    const response = await mcpRequest(serverWith(pages), {
      jsonrpc: "2.0",
      id: 11,
      method: "tools/call",
      params: {
        name: "create_page",
        arguments: {
          path: "about/tasks/daily-review",
          title: "Daily review",
          summary: "The owner's durable frame for reviewing each day.",
          body_markdown: "Review the day.",
          commit_message: "Create daily review",
        },
      },
    });

    expect(response.result?.isError).toBe(true);
    expect(response.result?.content?.[0]?.text).toBe([
      "KNOWLEDGE_GUIDE_REQUIRED",
      "Call begin_knowledge_session with {}, read the returned global guide, and retry with its knowledge_session_receipt when this target has no additional scoped guides.",
      'During the guidance transition, if scoped guides apply, call prepare_change with {"target_path":"about/tasks/daily-review"}, read the complete returned chain, and retry create_page with its guidance_receipt.',
    ].join("\n\n"));
    expect(response.result?.structuredContent).toBeUndefined();
    expect(calls).toEqual([]);
  });

  test("says a write's page id resolves to nothing instead of returning a bare null", async () => {
    const pages = pagesWithGuidance({
      async update() {
        return null;
      },
      async get() {
        return null;
      },
    });
    const missingId = "88888888-8888-4888-8888-888888888888";
    const update = await mcpRequest(serverWith(pages), {
      jsonrpc: "2.0",
      id: 12,
      method: "tools/call",
      params: {
        name: "update_page",
        arguments: {
          page_id: missingId,
          path: "companies/novamind/timeline",
          title: "NovaMind — Timeline",
          summary: "Dated developments involving NovaMind.",
          body_markdown: "## 2026",
          commit_message: "Record the deep dive",
          expected_version_number: 2,
          guidance_receipt: rootGuidanceReceipt,
        },
      },
    });

    expect(update.result?.isError).toBe(true);
    const text = update.result?.content?.[0]?.text ?? "";
    expect(text).toContain("PAGE_NOT_FOUND");
    expect(text).toContain(`No page has id ${missingId}`);
    expect(text).toContain("the page at companies/novamind/timeline");
    expect(text).toContain("retry update_page");
    expect(text).not.toBe("null");

    const archive = await mcpRequest(serverWith(pages), {
      jsonrpc: "2.0",
      id: 13,
      method: "tools/call",
      params: {
        name: "archive_page",
        arguments: {
          page_id: missingId,
          expected_version_number: 2,
          commit_message: "Archive it",
          guidance_receipt: rootGuidanceReceipt,
        },
      },
    });

    expect(archive.result?.isError).toBe(true);
    expect(archive.result?.content?.[0]?.text).toContain("PAGE_NOT_FOUND");
  });

  test("reports which read pages are public and which have drifted from publication", async () => {
    const publishedPage = {
      id: "55555555-5555-4555-8555-555555555555",
      current_path: "about/intro",
      current_version_id: "66666666-6666-4666-8666-666666666666",
      published_version_id: "77777777-7777-4777-8777-777777777777",
      published_version_number: 3,
      public_path: "about",
      archived_at: null,
      version_number: 7,
      title: "Massimo Albarello",
      summary: "Who the owner is.",
      body_markdown: "## Now",
    };
    const pages = {
      async getByPath() {
        return publishedPage;
      },
      async searchMetadata() {
        return [
          publishedPage,
          {
            ...publishedPage,
            id: "88888888-8888-4888-8888-888888888888",
            current_path: "about/intro/notes",
            published_version_id: null,
            published_version_number: null,
            public_path: null,
          },
        ];
      },
    } as unknown as PageRepository;

    const read = await mcpRequest(serverWith(pages), {
      jsonrpc: "2.0",
      id: 30,
      method: "tools/call",
      params: { name: "read_page", arguments: { path: "about/intro" } },
    });
    const page = JSON.parse(read.result?.content?.[0]?.text ?? "null");
    expect(page.publication).toEqual({
      state: "published",
      public_path: "about",
      published_version_number: 3,
      unpublished_changes: true,
    });
    expect(page).not.toHaveProperty("published_version_id");
    expect(page).not.toHaveProperty("public_path");

    const search = await mcpRequest(serverWith(pages), {
      jsonrpc: "2.0",
      id: 31,
      method: "tools/call",
      params: { name: "search_pages", arguments: { query: "owner" } },
    });
    expect(JSON.parse(search.result?.content?.[0]?.text ?? "null")).toMatchObject([
      { current_path: "about/intro", publication: { state: "published", public_path: "about" } },
      { current_path: "about/intro/notes", publication: { state: "private" } },
    ]);
  });

  test("reports a published version as current when no later version exists", async () => {
    const pages = {
      async getByPath() {
        return {
          id: "55555555-5555-4555-8555-555555555555",
          current_path: "about/intro",
          current_version_id: "77777777-7777-4777-8777-777777777777",
          published_version_id: "77777777-7777-4777-8777-777777777777",
          published_version_number: 3,
          public_path: "about",
          version_number: 3,
          title: "Massimo Albarello",
          summary: "Who the owner is.",
          body_markdown: "## Now",
        };
      },
    } as unknown as PageRepository;
    const read = await mcpRequest(serverWith(pages), {
      jsonrpc: "2.0",
      id: 32,
      method: "tools/call",
      params: { name: "read_page", arguments: { path: "about/intro" } },
    });
    expect(JSON.parse(read.result?.content?.[0]?.text ?? "null").publication).toEqual({
      state: "published",
      public_path: "about",
      published_version_number: 3,
      unpublished_changes: false,
    });
  });

  test("marks published pages while browsing so a target is chosen knowing its visibility", async () => {
    const directories = {
      async treeByPath() {
        return {
          id: "11111111-1111-4111-8111-111111111111",
          path: "about",
          title: "About",
          summary: "The owner.",
          guide: null,
          pages: [
            {
              id: "22222222-2222-4222-8222-222222222222",
              path: "about/intro",
              current_version_id: "33333333-3333-4333-8333-333333333333",
              published_version_id: "44444444-4444-4444-8444-444444444444",
              published_version_number: 3,
              public_path: "about",
              version_number: 7,
              title: "Massimo Albarello",
              summary: "Who the owner is.",
            },
            {
              id: "55555555-5555-4555-8555-555555555555",
              path: "about/health",
              current_version_id: "66666666-6666-4666-8666-666666666666",
              published_version_id: null,
              published_version_number: null,
              public_path: null,
              version_number: 2,
              title: "Health",
              summary: "Ongoing health detail.",
            },
          ],
          directories: [],
          directories_omitted: 0,
          requested_depth: 2,
          max_directories: 10,
          max_pages: 200,
          truncated: false,
        };
      },
    } as unknown as DirectoryRepository;

    const markdown = await mcpRequest(serverWith(
      {} as PageRepository,
      {} as AssetRepository,
      directories,
    ), {
      jsonrpc: "2.0",
      id: 33,
      method: "tools/call",
      params: { name: "browse_directory", arguments: { path: "about" } },
    });
    const text = markdown.result?.content?.[0]?.text ?? "";
    expect(text).toContain("`about/intro` (v7) · public `/p/about` — unpublished changes since v3");
    expect(text).toContain("`about/health` (v2) — Ongoing health detail.");
    expect(text).not.toContain("about/health` (v2) · public");

    const json = await mcpRequest(serverWith(
      {} as PageRepository,
      {} as AssetRepository,
      directories,
    ), {
      jsonrpc: "2.0",
      id: 34,
      method: "tools/call",
      params: { name: "browse_directory", arguments: { path: "about", format: "json" } },
    });
    const tree = JSON.parse(json.result?.content?.[0]?.text ?? "null");
    expect(tree.pages).toMatchObject([
      { path: "about/intro", publication: { state: "published", unpublished_changes: true } },
      { path: "about/health", publication: { state: "private" } },
    ]);
    expect(tree.max_pages).toBe(200);
    expect(tree.pages[0]).not.toHaveProperty("published_version_id");
  });

  test("refuses to edit a published page and names the private alternative", async () => {
    const updates: unknown[] = [];
    const publishedPage = {
      id: "55555555-5555-4555-8555-555555555555",
      current_path: "about/intro",
      current_version_id: "66666666-6666-4666-8666-666666666666",
      published_version_id: "77777777-7777-4777-8777-777777777777",
      published_version_number: 3,
      public_path: "about",
      version_number: 7,
      title: "Massimo Albarello",
      summary: "Who the owner is.",
      body_markdown: "## Now",
    };
    const pages = pagesWithGuidance({
      async get() {
        return publishedPage;
      },
      async update(pageId: string, input: unknown) {
        updates.push({ pageId, input });
        return { ...publishedPage, version_number: 8 };
      },
    });
    const edit = {
      page_id: publishedPage.id,
      path: "about/intro",
      title: "Massimo Albarello",
      summary: "Who the owner is.",
      body_markdown: "## Now\n\nDeclined the NovaMind offer.",
      commit_message: "Record the declined offer",
      expected_version_number: 7,
      guidance_receipt: rootGuidanceReceipt,
    };

    const refused = await mcpRequest(serverWith(pages), {
      jsonrpc: "2.0",
      id: 35,
      method: "tools/call",
      params: { name: "update_page", arguments: edit },
    });

    expect(refused.result?.isError).toBe(true);
    const text = refused.result?.content?.[0]?.text ?? "";
    expect(text).toContain("PUBLISHED_PAGE");
    expect(text).toContain("about/intro is published at /p/about");
    expect(text).toContain("published v3");
    expect(text).toContain("Prefer a private page");
    expect(text).toContain("acknowledge_published_page: true");
    expect(updates).toEqual([]);

    const acknowledged = await mcpRequest(serverWith(pages), {
      jsonrpc: "2.0",
      id: 36,
      method: "tools/call",
      params: {
        name: "update_page",
        arguments: { ...edit, acknowledge_published_page: true },
      },
    });

    expect(acknowledged.result?.isError).toBeUndefined();
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      pageId: publishedPage.id,
      input: { commit_message: "Record the declined offer" },
    });
    expect((updates[0] as { input: Record<string, unknown> }).input)
      .not.toHaveProperty("acknowledge_published_page");
  });

  test("leaves a private page edit unguarded by the published-page acknowledgement", async () => {
    const updates: unknown[] = [];
    const pages = pagesWithGuidance({
      async get() {
        return {
          id: "55555555-5555-4555-8555-555555555555",
          current_path: "about/health",
          current_version_id: "66666666-6666-4666-8666-666666666666",
          published_version_id: null,
          published_version_number: null,
          public_path: null,
          version_number: 2,
        };
      },
      async update(pageId: string, input: unknown) {
        updates.push({ pageId, input });
        return { id: pageId, current_path: "about/health", version_number: 3 };
      },
    });
    const response = await mcpRequest(serverWith(pages), {
      jsonrpc: "2.0",
      id: 37,
      method: "tools/call",
      params: {
        name: "update_page",
        arguments: {
          page_id: "55555555-5555-4555-8555-555555555555",
          path: "about/health",
          title: "Health",
          summary: "Ongoing health detail.",
          body_markdown: "## 2026",
          commit_message: "Record the appointment",
          expected_version_number: 2,
          guidance_receipt: rootGuidanceReceipt,
        },
      },
    });

    expect(response.result?.isError).toBeUndefined();
    expect(updates).toHaveLength(1);
    expect(JSON.parse(response.result?.content?.[0]?.text ?? "null").publication)
      .toEqual({ state: "private" });
  });

  test("reuses a receipt across stateless calls and targets with the same guide chain", async () => {
    const calls: unknown[] = [];
    const pages = pagesWithGuidance({
      async create(input: unknown) {
        calls.push(input);
        return { id: "77777777-7777-4777-8777-777777777777", ...input as object };
      },
    });
    const preparation = await mcpRequest(serverWith(pages), {
      jsonrpc: "2.0",
      id: 14,
      method: "tools/call",
      params: {
        name: "prepare_change",
        arguments: { target_path: "about/intro" },
      },
    });
    const receipt = preparedChangeResult(preparation).guidance_receipt;

    const mutation = await mcpRequest(serverWith(pages), {
      jsonrpc: "2.0",
      id: 15,
      method: "tools/call",
      params: {
        name: "create_page",
        arguments: {
          path: "about/intro",
          title: "Introduction",
          summary: "A concise introduction to the owner.",
          body_markdown: "Introduction.",
          commit_message: "Create introduction",
          guidance_receipt: receipt,
        },
      },
    });

    expect(mutation.result?.isError).not.toBe(true);
    const siblingMutation = await mcpRequest(serverWith(pages), {
      jsonrpc: "2.0",
      id: 16,
      method: "tools/call",
      params: {
        name: "create_page",
        arguments: {
          path: "library/notes",
          title: "Notes",
          summary: "A durable collection of notes.",
          body_markdown: "Notes.",
          commit_message: "Create notes",
          guidance_receipt: receipt,
        },
      },
    });

    expect(siblingMutation.result?.isError).not.toBe(true);
    expect(calls).toEqual([
      {
        path: "about/intro",
        title: "Introduction",
        summary: "A concise introduction to the owner.",
        body_markdown: "Introduction.",
        commit_message: "Create introduction",
      },
      {
        path: "library/notes",
        title: "Notes",
        summary: "A durable collection of notes.",
        body_markdown: "Notes.",
        commit_message: "Create notes",
      },
    ]);
  });

  test("rejects a parent receipt before writing in a folder with a newly applicable guide", async () => {
    const calls: unknown[] = [];
    const localGuide = {
      ...rootGuide,
      current_path: "library/private/agents",
      current_version_id: "99999999-9999-4999-8999-999999999999",
      body_markdown: "Private library guidance",
    };
    const pages = {
      async guidesForPath() {
        return [rootGuide, localGuide];
      },
      async create(input: unknown) {
        calls.push(input);
        return input;
      },
    } as unknown as PageRepository;

    const mutation = await mcpRequest(serverWith(pages), {
      jsonrpc: "2.0",
      id: 44,
      method: "tools/call",
      params: {
        name: "create_page",
        arguments: {
          path: "library/private/notes",
          title: "Private notes",
          summary: "Private notes governed by the local library guide.",
          body_markdown: "Notes.",
          commit_message: "Create private notes",
          guidance_receipt: rootGuidanceReceipt,
        },
      },
    });

    expect(mutation.result?.isError).toBe(true);
    expect(mutation.result?.content?.[0]?.text).toContain(
      'prepare_change with {"target_path":"library/private/notes"}',
    );
    expect(calls).toEqual([]);
  });

  test("deletes only an inspected empty directory and reports content blockers", async () => {
    const deleted: unknown[] = [];
    const directory = {
      id: "88888888-8888-4888-8888-888888888888",
      current_path: "automations/feed-digest",
      version_number: 2,
      title: "Feed digest",
    };
    const directories = {
      async get(id: string) {
        expect(id).toBe(directory.id);
        return directory;
      },
      async delete(id: string, input: unknown) {
        deleted.push({ id, input });
        return { id, current_path: directory.current_path };
      },
    } as unknown as DirectoryRepository;
    const success = await mcpRequest(serverWith(
      pagesWithGuidance(),
      {} as AssetRepository,
      directories,
    ), {
      jsonrpc: "2.0",
      id: 16,
      method: "tools/call",
      params: {
        name: "delete_directory",
        arguments: {
          directory_id: directory.id,
          expected_version_number: 2,
          guidance_receipt: rootGuidanceReceipt,
        },
      },
    });
    expect(success.result?.isError).not.toBe(true);
    expect(deleted).toEqual([{ id: directory.id, input: { expected_version_number: 2 } }]);

    const blockedDirectories = {
      ...directories,
      async delete() {
        throw new DirectoryNotEmptyError({ activePages: 1, archivedPages: 0, assets: 2, directories: 0 });
      },
    } as unknown as DirectoryRepository;
    const blocked = await mcpRequest(serverWith(
      pagesWithGuidance(),
      {} as AssetRepository,
      blockedDirectories,
    ), {
      jsonrpc: "2.0",
      id: 17,
      method: "tools/call",
      params: {
        name: "delete_directory",
        arguments: {
          directory_id: directory.id,
          expected_version_number: 2,
          guidance_receipt: rootGuidanceReceipt,
        },
      },
    });
    expect(blocked.result?.isError).toBe(true);
    expect(blocked.result?.content?.[0]?.text).toContain("1 active page, 2 assets");
    expect(blocked.result?.content?.[0]?.text).toContain("Delete all pages, assets, and child directories");
  });

  test("rejects a receipt when an applicable guide has changed", async () => {
    const calls: unknown[] = [];
    const staleReceipt = createGuidanceReceipt([rootGuide], DEFAULT_MCP_CONTEXT);
    const changedRoot = {
      ...rootGuide,
      current_version_id: "55555555-5555-4555-8555-555555555555",
      version_number: 2,
      body_markdown: "Changed root guide",
    };
    const pages = {
      async guidesForPath() {
        return [changedRoot];
      },
      async create(input: unknown) {
        calls.push(input);
        return input;
      },
    } as unknown as PageRepository;
    const knowledgeSettings = {
      async globalGuide() {
        return {
          document_id: changedRoot.id,
          current_revision_id: changedRoot.current_version_id,
          revision_number: changedRoot.version_number,
          title: changedRoot.title,
          summary: "Changed test global guide.",
        };
      },
    } as unknown as KnowledgeSettingsRepository;
    const response = await mcpRequest(serverWith(
      pages,
      {} as AssetRepository,
      {} as DirectoryRepository,
      undefined,
      { knowledgeSettings },
    ), {
      jsonrpc: "2.0",
      id: 12,
      method: "tools/call",
      params: {
        name: "create_page",
        arguments: {
          path: "about/intro",
          title: "Introduction",
          summary: "A concise introduction to the owner.",
          body_markdown: "Introduction.",
          commit_message: "Create introduction",
          guidance_receipt: staleReceipt,
        },
      },
    });

    expect(response.result?.isError).toBe(true);
    expect(response.result?.content?.[0]?.text).toContain(
      'prepare_change with {"target_path":"about/intro"}',
    );
    expect(calls).toEqual([]);

    const refreshed = await mcpRequest(serverWith(
      pages,
      {} as AssetRepository,
      {} as DirectoryRepository,
      undefined,
      { knowledgeSettings },
    ), {
      jsonrpc: "2.0",
      id: 43,
      method: "tools/call",
      params: {
        name: "prepare_change",
        arguments: {
          target_path: "about/intro",
          cached_guidance_receipt: staleReceipt,
        },
      },
    });
    const refreshedGuidance = preparedChangeResult(refreshed);
    expect(refreshedGuidance.guides).toEqual([
      { path: "agents", body_markdown: "Changed root guide" },
    ]);
    expect(verifyGuidanceReceipt(
      refreshedGuidance.guidance_receipt,
      [changedRoot],
      DEFAULT_MCP_CONTEXT,
    )).toBe(true);
  });

  test("resolves an ID-only mutation target before directing guidance recovery", async () => {
    const archiveCalls: string[] = [];
    const assets = {
      async get(assetId: string) {
        return {
          id: assetId,
          current_path: "library/private/recording",
          filename: "recording.mp3",
        };
      },
      async archive(assetId: string) {
        archiveCalls.push(assetId);
        return null;
      },
    } as unknown as AssetRepository;
    const response = await mcpRequest(serverWith(pagesWithGuidance(), assets), {
      jsonrpc: "2.0",
      id: 13,
      method: "tools/call",
      params: {
        name: "archive_asset",
        arguments: { asset_id: "66666666-6666-4666-8666-666666666666" },
      },
    });

    expect(response.result?.isError).toBe(true);
    expect(response.result?.content?.[0]?.text).toBe([
      "KNOWLEDGE_GUIDE_REQUIRED",
      "Call begin_knowledge_session with {}, read the returned global guide, and retry with its knowledge_session_receipt when this target has no additional scoped guides.",
      'During the guidance transition, if scoped guides apply, call prepare_change with {"target_path":"library/private/recording"}, read the complete returned chain, and retry archive_asset with its guidance_receipt.',
    ].join("\n\n"));
    expect(archiveCalls).toEqual([]);
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
    const response = await mcpRequest(serverWith(pages), {
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
            current_version_id: "33333333-3333-4333-8333-333333333333",
            published_version_id: "44444444-4444-4444-8444-444444444444",
            published_version_number: 2,
            public_path: "chapters/como",
          }, {
            kind: "directory",
            id: "55555555-5555-4555-8555-555555555555",
            path: "about/chapters/zurich",
            title: "Zurich",
            summary: "The Zurich years.",
            current_version_id: null,
            published_version_id: null,
            published_version_number: null,
            public_path: null,
          }],
        };
      },
    } as unknown as DirectoryRepository;
    const response = await mcpRequest(serverWith(
      {} as PageRepository,
      {} as AssetRepository,
      directories,
    ), {
      jsonrpc: "2.0",
      id: 10,
      method: "tools/call",
      params: { name: "read_directory", arguments: { path: "about/chapters" } },
    });
    const index = JSON.parse(response.result?.content?.[0]?.text ?? "null");
    expect(index).toMatchObject({
      reference: "context-use://directory/11111111-1111-4111-8111-111111111111",
    });
    expect(index.children[0]).toMatchObject({
      title: "Como",
      summary: "Growing up at the foot of the Alps.",
      publication: {
        state: "published",
        public_path: "chapters/como",
        published_version_number: 2,
        unpublished_changes: true,
      },
    });
    expect(index.children[0]).not.toHaveProperty("published_version_id");
    // A directory is reachable only through the indexes its published descendants generate,
    // so it has no publication state of its own to report.
    expect(index.children[1]).not.toHaveProperty("publication");
    expect(index.children[1]).not.toHaveProperty("public_path");
  });

  test("browses nested page metadata with directory guides promoted separately", async () => {
    const directories = {
      async treeByPath(path: string, depth: number, maxPages: number, maxDirectories: number) {
        expect({ path, depth, maxPages, maxDirectories }).toEqual({
          path: "about",
          depth: 3,
          maxPages: 100,
          maxDirectories: 7,
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
          directories_omitted: 2,
          directories: [{
            id: "44444444-4444-4444-8444-444444444444",
            path: "about/tasks",
            title: "Tasks",
            summary: "Current and historical efforts.",
            guide: null,
            pages: [],
            directories: [],
            directories_omitted: 0,
          }],
          requested_depth: depth,
          max_directories: maxDirectories,
          max_pages: maxPages,
          truncated: true,
        };
      },
    } as unknown as DirectoryRepository;
    const response = await mcpRequest(serverWith(
      {} as PageRepository,
      {} as AssetRepository,
      directories,
    ), {
      jsonrpc: "2.0",
      id: 11,
      method: "tools/call",
      params: {
        name: "browse_directory",
        arguments: { path: "about", depth: 3, max_pages: 100, max_directories: 7 },
      },
    });
    expect(response.result?.content?.[0]?.text).toContain("# Directory browse");
    expect(response.result?.content?.[0]?.text).toContain("- **About** `about` — Knowledge about the owner.");
    expect(response.result?.content?.[0]?.text).toContain("- Guide: **AGENTS.md** `about/agents` (v1)");
    expect(response.result?.content?.[0]?.text).toContain("- Page: **Introduction** `about/intro` (v2)");
    expect(response.result?.content?.[0]?.text).toContain("_… 2 more directories not shown_");
    expect(response.result?.content?.[0]?.text).toContain("Depth: 3 · Directory limit: 7/folder · Page limit: 100 · Truncated: yes");
    expect(response.result?.structuredContent).toBeUndefined();

    const jsonResponse = await mcpRequest(serverWith(
      {} as PageRepository,
      {} as AssetRepository,
      directories,
    ), {
      jsonrpc: "2.0",
      id: 12,
      method: "tools/call",
      params: {
        name: "browse_directory",
        arguments: { path: "about", depth: 3, max_pages: 100, max_directories: 7, format: "json" },
      },
    });
    expect(JSON.parse(jsonResponse.result?.content?.[0]?.text ?? "null")).toMatchObject({
      path: "about",
      guide: { path: "about/agents", title: "AGENTS.md" },
      pages: [{ path: "about/intro", title: "Introduction" }],
      directories: [{ path: "about/tasks" }],
      directories_omitted: 2,
      max_directories: 7,
      truncated: true,
    });
    expect(jsonResponse.result?.structuredContent).toBeUndefined();
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
    const listed = await mcpRequest(serverWith(pages), {
      jsonrpc: "2.0",
      id: 12,
      method: "tools/list",
      params: {},
    });
    const loadSkill = listed.result?.tools?.find(({ name }) => name === "read_skill");
    expect(loadSkill?.description).toContain("job-search-review");
    expect(loadSkill?.description).toContain("Evaluate roles against");
    expect(loadSkill?.description).not.toContain("skills/agents");

    const loaded = await mcpRequest(serverWith(pages), {
      jsonrpc: "2.0",
      id: 13,
      method: "tools/call",
      params: { name: "read_skill", arguments: { name: "job-search-review" } },
    });
    expect(JSON.parse(loaded.result?.content?.[0]?.text ?? "null")).toMatchObject({
      current_path: "skills/job-search-review",
      title: "SKILL.md",
    });
  });

  test("exposes knowledge and asset tools without publication capabilities", async () => {
    const knowledge = await mcpRequest(serverWith(), {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    });
    const knowledgeTools = knowledge.result?.tools?.map(({ name }) => name) ?? [];
    expect(knowledgeTools).toEqual(expect.arrayContaining([
      "read_directory",
      "browse_directory",
      "create_directory",
      "delete_directory",
      "read_page",
      "list_page_changes",
      "compare_page_versions",
      "begin_knowledge_session",
      "prepare_change",
      "read_skill",
      "create_page",
      "update_page",
      "create_asset_upload",
      "archive_asset",
    ]));

    const createPage = knowledge.result?.tools?.find(({ name }) => name === "create_page");
    expect(createPage?.description).toContain("input schema defines summaries");
    expect(createPage?.inputSchema?.properties?.body_markdown?.description).toContain("layout=half");
    expect(knowledge.result?.tools?.find(({ name }) => name === "browse_directory")
      ?.inputSchema?.properties?.max_directories).toMatchObject({
        default: 10,
        minimum: 1,
        maximum: 100,
      });
    expect(knowledge.result?.tools?.find(({ name }) => name === "browse_directory")
      ?.inputSchema?.properties?.format).toMatchObject({
        default: "markdown",
        enum: ["markdown", "json"],
      });
    expect(knowledge.result?.tools?.find(({ name }) => name === "create_asset_upload")
      ?.inputSchema?.properties?.path?.description).toContain("not of the folder holding it");
    expect(knowledge.result?.tools?.find(({ name }) => name === "update_page")?.description)
      .toContain("begin_knowledge_session");
    const beginSession = knowledge.result?.tools?.find(({ name }) => (
      name === "begin_knowledge_session"
    ));
    expect(beginSession?.inputSchema?.properties ?? {}).toEqual({});
    expect(beginSession?.description).toContain("Call once");
    expect(beginSession?.description).toContain("targets without additional scoped guides");
    expect(beginSession?.description).toContain("requires prepare_change");
    expect(knowledge.result?.tools?.find(({ name }) => name === "prepare_change")?.inputSchema?.properties)
      .toHaveProperty("cached_guidance_receipt");
    expect(knowledge.result?.tools?.find(({ name }) => name === "prepare_change")?.outputSchema?.properties)
      .toHaveProperty("guides");
    for (const name of [
      "create_directory",
      "update_directory",
      "delete_directory",
      "create_page",
      "update_page",
      "archive_page",
      "create_asset_upload",
      "archive_asset",
    ]) {
      expect(knowledge.result?.tools?.find((tool) => tool.name === name)?.inputSchema?.properties)
        .toHaveProperty("guidance_receipt");
      expect(knowledge.result?.tools?.find((tool) => tool.name === name)?.inputSchema?.properties)
        .toHaveProperty("knowledge_session_receipt");
    }
    expect(knowledgeTools.some((name) => name.includes("publish"))).toBe(false);
    expect(knowledgeTools.some((name) => name.includes("automation"))).toBe(false);
    expect(knowledgeTools).not.toContain("list_pages");
    expect(knowledgeTools).not.toContain("list_directories");
    expect(knowledgeTools).not.toEqual(expect.arrayContaining([
      "get_directory",
      "get_page",
      "prepare_knowledge_write",
      "load_skill",
      "get_knowledge_changes",
      "get_page_delta",
      "get_page_history",
      "get_page_version",
      "get_asset",
    ]));
    expect(knowledgeTools).not.toEqual(expect.arrayContaining([
      "list_skills",
      "get_skill",
      "create_skill",
    ]));
    expect(knowledgeTools).not.toContain("get_knowledge_base_guide");
    expect(knowledgeTools).not.toContain("get_markdown_guide");
  });

  test("reads a fixed, deduplicated knowledge-change window with harness-owned cursors", async () => {
    const calls: unknown[] = [];
    const pages = pagesWithGuidance({
      async changesSince(input: unknown) {
        calls.push(input);
        return {
          changes: [{
            cursor: "cu-page-changes-v1.9",
            page_id: "11111111-1111-4111-8111-111111111111",
            version_id: "22222222-2222-4222-8222-222222222222",
            version_number: 4,
            previous_version_number: 2,
            change_kind: "updated",
            path: "about/intro",
            title: "Introduction",
            commit_message: "Reconcile introduction",
            actor_kind: "mcp",
            actor_subject: "client/session",
            changed_at: "2026-08-06T10:00:00.000Z",
          }],
          next_cursor: "cu-page-changes-v1.c",
          next_page_token: "cu-page-scan-v1.5.c.9",
          has_more: true,
        };
      },
    });
    const response = await mcpRequest(serverWith(pages), {
      jsonrpc: "2.0",
      id: 15,
      method: "tools/call",
      params: {
        name: "list_page_changes",
        arguments: { cursor: "cu-page-changes-v1.5", limit: 25 },
      },
    });

    expect(calls).toEqual([{ cursor: "cu-page-changes-v1.5", limit: 25 }]);
    expect(response.result?.structuredContent).toMatchObject({
      changes: [{ path: "about/intro", version_number: 4, previous_version_number: 2 }],
      next_cursor: "cu-page-changes-v1.c",
      has_more: true,
    });
    expect(response.result?.content?.[0]?.text).not.toContain("body_markdown");
  });

  test("returns one clean compact delta for multiple distant changes", async () => {
    const calls: unknown[] = [];
    const pages = pagesWithGuidance({
      async version(pageId: string, versionNumber: number) {
        calls.push({ pageId, versionNumber });
        const versions = {
          2: {
            path: "projects/context-use/timeline",
            title: "Context Use timeline",
            summary: "Important project developments.",
            body_markdown: [
              "# Timeline\n",
              "\n",
              "## 2026\n",
              "\n",
              "- 2026-08-10 — Opened the draft.\n",
              "\n",
              "This context remains unchanged.\n",
              "\n",
              "No follow-up was planned.\n",
            ].join(""),
          },
          4: {
            path: "projects/context-use/timeline",
            title: "Context Use timeline",
            summary: "Important project developments.",
            body_markdown: [
              "# Timeline\n",
              "\n",
              "## 2026\n",
              "\n",
              "- 2026-08-10 — Opened the pull request.\n",
              "\n",
              "This context remains unchanged.\n",
              "\n",
              "Scheduled a follow-up for Friday.\n",
            ].join(""),
          },
        };
        return versions[versionNumber as keyof typeof versions] ?? null;
      },
    });
    const response = await mcpRequest(serverWith(pages), {
      jsonrpc: "2.0",
      id: 16,
      method: "tools/call",
      params: {
        name: "compare_page_versions",
        arguments: {
          page_id: "11111111-1111-4111-8111-111111111111",
          previous_version_number: 2,
          version_number: 4,
        },
      },
    });

    expect(calls).toEqual([
      { pageId: "11111111-1111-4111-8111-111111111111", versionNumber: 2 },
      { pageId: "11111111-1111-4111-8111-111111111111", versionNumber: 4 },
    ]);
    const expectedDelta = {
      page_id: "11111111-1111-4111-8111-111111111111",
      comparison: {
        requested_from_version: 2,
        actual_from_version: 2,
        to_version: 4,
        complete: true,
      },
      metadata_changes: [],
      markdown_changes: [
        {
          before: "- 2026-08-10 — Opened the draft.\n",
          after: "- 2026-08-10 — Opened the pull request.\n",
        },
        {
          before: "No follow-up was planned.\n",
          after: "Scheduled a follow-up for Friday.\n",
        },
      ],
    };
    expect(response.result?.structuredContent).toEqual(expectedDelta);
    expect(response.result?.content?.[0]?.text).toBe(JSON.stringify(expectedDelta, null, 2));
  });

  test("falls back to the oldest retained version when the exact baseline was pruned", async () => {
    const fallbackCalls: unknown[] = [];
    const pages = pagesWithGuidance({
      async version(_pageId: string, versionNumber: number) {
        return versionNumber === 8 ? {
          path: "people/ada/intro",
          title: "Ada",
          summary: "A collaborator.",
          body_markdown: "# Ada\n\nStarted a new role.\n",
        } : null;
      },
      async oldestRetainedVersionAfter(
        pageId: string,
        afterVersionNumber: number,
        throughVersionNumber: number,
      ) {
        fallbackCalls.push({ pageId, afterVersionNumber, throughVersionNumber });
        return {
          version_number: 4,
          path: "people/ada/intro",
          title: "Ada",
          summary: "A collaborator.",
          body_markdown: "# Ada\n\nConsidered a new role.\n",
        };
      },
    });
    const response = await mcpRequest(serverWith(pages), {
      jsonrpc: "2.0",
      id: 17,
      method: "tools/call",
      params: {
        name: "compare_page_versions",
        arguments: {
          page_id: "11111111-1111-4111-8111-111111111111",
          previous_version_number: 3,
          version_number: 8,
        },
      },
    });

    expect(fallbackCalls).toEqual([{
      pageId: "11111111-1111-4111-8111-111111111111",
      afterVersionNumber: 3,
      throughVersionNumber: 8,
    }]);
    expect(response.result?.structuredContent).toEqual({
      page_id: "11111111-1111-4111-8111-111111111111",
      comparison: {
        requested_from_version: 3,
        actual_from_version: 4,
        to_version: 8,
        complete: false,
      },
      metadata_changes: [],
      markdown_changes: [{
        before: "Considered a new role.\n",
        after: "Started a new role.\n",
      }],
    });
  });

  test("reports an unavailable window end without substituting another version", async () => {
    const pages = pagesWithGuidance({
      async version() {
        return null;
      },
    });
    const response = await mcpRequest(serverWith(pages), {
      jsonrpc: "2.0",
      id: 18,
      method: "tools/call",
      params: {
        name: "compare_page_versions",
        arguments: {
          page_id: "11111111-1111-4111-8111-111111111111",
          previous_version_number: 3,
          version_number: 8,
        },
      },
    });

    expect(response.result?.isError).toBe(true);
    expect(response.result?.structuredContent).toBeUndefined();
    expect(response.result?.content?.[0]?.text).toBe([
      "PAGE_DELTA_UNAVAILABLE",
      "Page 11111111-1111-4111-8111-111111111111 version 8 is not retained; no safe comparison was produced.",
    ].join("\n\n"));
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
    const response = await mcpRequest(serverWith(pagesWithGuidance(), assets, directoriesWith()), {
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
          guidance_receipt: rootGuidanceReceipt,
        },
      },
    });

    const result = JSON.parse(response.result?.content?.[0]?.text ?? "null");
    expect(result.page_markdown.default).toBe("![Portrait.jpg](context-use://document/11111111-1111-4111-8111-111111111111)");
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
    const response = await mcpRequest(serverWith(pagesWithGuidance(), assets, directoriesWith()), {
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
          guidance_receipt: rootGuidanceReceipt,
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
    expect(result.reference).toBe("context-use://document/11111111-1111-4111-8111-111111111111");
    expect(result.upload).toMatchObject({
      method: "PUT",
      headers: { "content-type": "application/pdf", "content-length": "123" },
    });
    expect(typeof result.upload.headers["x-context-use-upload-token"]).toBe("string");
    expect(JSON.stringify(result)).not.toContain("secret-key");
  });

  test("refuses an asset upload aimed at the folder instead of the asset", async () => {
    const calls: unknown[] = [];
    const assets = {
      async create(input: unknown) {
        calls.push(input);
        return {};
      },
    } as unknown as AssetRepository;
    const response = await mcpRequest(
      serverWith(pagesWithGuidance(), assets, directoriesWith(["library/some-paper"])),
      {
        jsonrpc: "2.0",
        id: 11,
        method: "tools/call",
        params: {
          name: "create_asset_upload",
          arguments: {
            path: "library/some-paper",
            filename: "paper.pdf",
            content_type: "application/pdf",
            size_bytes: 123,
            sha256: "a".repeat(64),
            guidance_receipt: rootGuidanceReceipt,
          },
        },
      },
    );

    expect(calls).toEqual([]);
    expect(response.result?.isError).toBe(true);
    expect(response.result?.content?.[0]?.text).toContain("ASSET_PATH_IS_A_DIRECTORY");
    expect(response.result?.content?.[0]?.text).toContain("library/some-paper/<asset-name>");
  });

  test("archives asset metadata without receiving a storage-delete capability", async () => {
    const calls: string[] = [];
    const assets = {
      async get(assetId: string) {
        return {
          id: assetId,
          current_path: "documents/private-pdf",
          filename: "private.pdf",
        };
      },
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
    const response = await mcpRequest(serverWith(pagesWithGuidance(), assets), {
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: {
        name: "archive_asset",
        arguments: {
          asset_id: "11111111-1111-4111-8111-111111111111",
          guidance_receipt: rootGuidanceReceipt,
        },
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
    const response = await mcpRequest(serverWith({} as PageRepository, assets), {
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: {
        name: "read_asset",
        arguments: { asset_id: "11111111-1111-4111-8111-111111111111" },
      },
    });

    const result = JSON.parse(response.result?.content?.[0]?.text ?? "null");
    expect(result.download).toMatchObject({
      method: "GET",
      url: "http://localhost:3000/api/mcp/assets/11111111-1111-4111-8111-111111111111/content",
    });
    expect(result).toMatchObject({
      reference: "context-use://document/11111111-1111-4111-8111-111111111111",
      hypermedia: {
        links_indexed: true,
        outbound_document_ids: [],
        backlinks: [],
        backlinks_has_more: false,
      },
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
    const pages = pagesWithGuidance({
      async create(input: unknown, actor: unknown) {
        calls.push({ operation: "page", input, actor });
        return { id: "11111111-1111-4111-8111-111111111111", ...input as object };
      },
    });

    const skill = await mcpRequest(serverWith(pages), {
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
          guidance_receipt: rootGuidanceReceipt,
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

});
