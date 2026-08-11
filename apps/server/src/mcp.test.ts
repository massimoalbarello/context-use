import { describe, expect, test } from "bun:test";
import type { AssetRepository, DirectoryRepository, PageRepository } from "@context-use/database";
import { DirectoryNotEmptyError } from "@context-use/database";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { verifyAssetCapability } from "./mcp-asset-capability.ts";
import { createGuidanceReceipt, verifyGuidanceReceipt } from "./mcp-guidance-receipt.ts";
import { createMcpServer, KNOWLEDGE_BASE_INSTRUCTIONS, SOURCE_RECORD_INSTRUCTIONS } from "./mcp-server.ts";
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
  pages = {} as PageRepository,
  assets = {} as AssetRepository,
  directories = {} as DirectoryRepository,
  sourceRecords?: SourceRecordReader,
) {
  return createMcpServer(
    { clientId: "mcp-client", sessionId: "mcp-session" },
    pages,
    directories,
    assets,
    sourceRecords,
  );
}

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

const rootGuidanceReceipt = createGuidanceReceipt([rootGuide]);

describe("MCP knowledge tools", () => {
  test("gives clients the canonical knowledge structure during initialization", async () => {
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

    expect(response.result?.instructions).toContain(KNOWLEDGE_BASE_INSTRUCTIONS);
    expect(response.result?.instructions).not.toContain("about/intro");
    expect(response.result?.instructions).toContain("guides are authoritative");
    expect(response.result?.instructions).toContain("AGENTS.md");
    expect(response.result?.instructions).toContain("Available reusable skills");
  });

  test("exposes one unified checkpointed source reader when Nango access is configured", async () => {
    const calls: unknown[] = [];
    const sourceRecords = {
      async read(input: unknown) {
        calls.push(input);
        return {
          records: [{
            record_ref: `nango:${"a".repeat(64)}`,
            source: "GitHub",
            action: "added" as const,
            markdown: "# Pull request\n\nImplemented the record pipeline.",
          }],
          next_checkpoint: "cu-nango-v1.opaque",
          has_more: false,
        };
      },
    } as SourceRecordReader;
    const initialized = await mcpRequest(serverWith(
      {} as PageRepository,
      {} as AssetRepository,
      {} as DirectoryRepository,
      sourceRecords,
    ), {
      jsonrpc: "2.0",
      id: 20,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" },
      },
    });
    expect(initialized.result?.instructions).toContain(SOURCE_RECORD_INSTRUCTIONS);

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
    expect(tool?.description).toContain("bounded, checkpointed batch");
    expect(tool?.description).toContain("more than 30 days old");
    expect(tool?.description).toContain("added, updated, or deleted action");
    expect(tool?.description).toContain("Reconcile this batch and persist next_checkpoint before calling again");
    expect(tool?.description).toContain("only later lifecycle changes");
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
      records: [{ source: "GitHub", action: "added", markdown: expect.stringContaining("record pipeline") }],
      next_checkpoint: "cu-nango-v1.opaque",
      has_more: false,
    });
    expect(read.result?.structuredContent?.batch_bytes).toBeUndefined();
    expect(calls).toEqual([{ checkpoint: "cu-nango-v1.previous", limit: 25 }]);
  });

  test("reads pages by semantic path and prepares applicable write guides", async () => {
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
      params: { name: "get_page", arguments: { path: "agents" } },
    });

    expect(JSON.parse(pageResponse.result?.content?.[0]?.text ?? "null")).toMatchObject({
      current_path: "agents",
      title: "AGENTS.md",
    });

    const contextResponse = await mcpRequest(serverWith(pages), {
      jsonrpc: "2.0",
      id: 10,
      method: "tools/call",
      params: {
        name: "prepare_knowledge_write",
        arguments: { target_path: "about/tasks/job-search/criteria" },
      },
    });
    const prepared = contextResponse.result?.content?.[0]?.text ?? "";
    expect(prepared).toContain("TARGET_PATH: about/tasks/job-search/criteria");
    expect(prepared).toContain("BEGIN GUIDE 1/2: Root AGENTS.md");
    expect(prepared).toContain("BEGIN GUIDE 2/2: about/tasks/job-search/AGENTS.md");
    expect(prepared.indexOf("Root guide")).toBeLessThan(prepared.indexOf("Local guide"));
    const receipt = prepared.match(/^GUIDANCE_RECEIPT: (\S+)/)?.[1];
    expect(receipt).toBeTruthy();
    expect(verifyGuidanceReceipt(receipt!, guides)).toBe(true);
    expect(contextResponse.result?.structuredContent).toBeUndefined();
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
        name: "prepare_knowledge_write",
        arguments: { target_path: "about/profile" },
      },
    });
    const aboutPrepared = aboutPreparation.result?.content?.[0]?.text ?? "";
    const aboutReceipt = aboutPrepared.match(/^GUIDANCE_RECEIPT: (\S+)/)?.[1];
    expect(aboutReceipt).toBeTruthy();
    expect(aboutPrepared).toContain("Unique root instructions body");
    expect(aboutPrepared).toContain("Unique about instructions body");

    const tasksPreparation = await mcpRequest(serverWith(pages), {
      jsonrpc: "2.0",
      id: 41,
      method: "tools/call",
      params: {
        name: "prepare_knowledge_write",
        arguments: {
          target_path: "about/tasks/daily-review",
          cached_guidance_receipt: aboutReceipt,
        },
      },
    });
    const tasksPrepared = tasksPreparation.result?.content?.[0]?.text ?? "";
    const tasksReceipt = tasksPrepared.match(/^GUIDANCE_RECEIPT: (\S+)/)?.[1];
    expect(tasksReceipt).toBeTruthy();
    expect(tasksPrepared).toContain("CACHE_STATUS: Reused 2 unchanged guides; loaded 1 new or changed guide.");
    expect(tasksPrepared).toContain("CACHED: Root AGENTS.md");
    expect(tasksPrepared).toContain("CACHED: about/AGENTS.md");
    expect(tasksPrepared).toContain("LOADED: about/tasks/AGENTS.md");
    expect(tasksPrepared).not.toContain("Unique root instructions body");
    expect(tasksPrepared).not.toContain("Unique about instructions body");
    expect(tasksPrepared).toContain("Unique task instructions body");
    expect(tasksPrepared).toContain("BEGIN GUIDE 3/3: about/tasks/AGENTS.md");
    expect(verifyGuidanceReceipt(tasksReceipt!, [rootWithUniqueBody, aboutGuide, tasksGuide])).toBe(true);

    const placesPreparation = await mcpRequest(serverWith(pages), {
      jsonrpc: "2.0",
      id: 42,
      method: "tools/call",
      params: {
        name: "prepare_knowledge_write",
        arguments: {
          target_path: "places/london",
          cached_guidance_receipt: tasksReceipt,
        },
      },
    });
    const placesPrepared = placesPreparation.result?.content?.[0]?.text ?? "";
    expect(placesPrepared).toContain("CACHE_STATUS: Reused 1 unchanged guide; loaded 1 new or changed guide.");
    expect(placesPrepared).not.toContain("Unique root instructions body");
    expect(placesPrepared).toContain("Unique place instructions body");
    expect(placesPrepared).toContain("GUIDES_NO_LONGER_APPLICABLE:");
    expect(placesPrepared).toContain("- about/AGENTS.md");
    expect(placesPrepared).toContain("- about/tasks/AGENTS.md");
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
      "GUIDANCE_REQUIRED",
      'Call prepare_knowledge_write with {"target_path":"about/tasks/daily-review"}.',
      "If you have a previously returned receipt, also pass it as cached_guidance_receipt so unchanged guides are not repeated.",
      "Then retry create_page with the returned guidance_receipt.",
    ].join("\n\n"));
    expect(response.result?.structuredContent).toBeUndefined();
    expect(calls).toEqual([]);
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
        name: "prepare_knowledge_write",
        arguments: { target_path: "about/intro" },
      },
    });
    const receipt = preparation.result?.content?.[0]?.text.match(/^GUIDANCE_RECEIPT: (\S+)/)?.[1];
    expect(receipt).toBeTruthy();

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
      'prepare_knowledge_write with {"target_path":"library/private/notes"}',
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
    const staleReceipt = createGuidanceReceipt([rootGuide]);
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
    const response = await mcpRequest(serverWith(pages), {
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
      'prepare_knowledge_write with {"target_path":"about/intro"}',
    );
    expect(calls).toEqual([]);

    const refreshed = await mcpRequest(serverWith(pages), {
      jsonrpc: "2.0",
      id: 43,
      method: "tools/call",
      params: {
        name: "prepare_knowledge_write",
        arguments: {
          target_path: "about/intro",
          cached_guidance_receipt: staleReceipt,
        },
      },
    });
    const refreshedGuidance = refreshed.result?.content?.[0]?.text ?? "";
    const refreshedReceipt = refreshedGuidance.match(/^GUIDANCE_RECEIPT: (\S+)/)?.[1];
    expect(refreshedGuidance).toContain("CACHE_STATUS: Reused 0 unchanged guides; loaded 1 new or changed guide.");
    expect(refreshedGuidance).toContain("REPLACED_CACHED_GUIDES:\n- Root AGENTS.md");
    expect(refreshedGuidance).toContain("Changed root guide");
    expect(verifyGuidanceReceipt(refreshedReceipt!, [changedRoot])).toBe(true);
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
      "GUIDANCE_REQUIRED",
      'Call prepare_knowledge_write with {"target_path":"library/private/recording"}.',
      "If you have a previously returned receipt, also pass it as cached_guidance_receipt so unchanged guides are not repeated.",
      "Then retry archive_asset with the returned guidance_receipt.",
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
    const listed = await mcpRequest(serverWith(pages), {
      jsonrpc: "2.0",
      id: 12,
      method: "tools/list",
      params: {},
    });
    const loadSkill = listed.result?.tools?.find(({ name }) => name === "load_skill");
    expect(loadSkill?.description).toContain("job-search-review");
    expect(loadSkill?.description).toContain("Evaluate roles against");
    expect(loadSkill?.description).not.toContain("skills/agents");

    const loaded = await mcpRequest(serverWith(pages), {
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

  test("exposes knowledge and asset tools without publication capabilities", async () => {
    const knowledge = await mcpRequest(serverWith(), {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    });
    const knowledgeTools = knowledge.result?.tools?.map(({ name }) => name) ?? [];
    expect(knowledgeTools).toEqual(expect.arrayContaining([
      "get_directory",
      "browse_directory",
      "create_directory",
      "delete_directory",
      "get_page",
      "get_knowledge_changes",
      "prepare_knowledge_write",
      "load_skill",
      "create_page",
      "update_page",
      "create_asset_upload",
      "archive_asset",
    ]));

    const createPage = knowledge.result?.tools?.find(({ name }) => name === "create_page");
    expect(createPage?.description).toContain("body_markdown schema");
    expect(createPage?.inputSchema?.properties?.body_markdown?.description).toContain("layout=half");
    expect(knowledge.result?.tools?.find(({ name }) => name === "update_page")?.description).toContain("prepare_knowledge_write");
    expect(knowledge.result?.tools?.find(({ name }) => name === "prepare_knowledge_write")?.inputSchema?.properties)
      .toHaveProperty("cached_guidance_receipt");
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
    }
    expect(knowledgeTools.some((name) => name.includes("publish"))).toBe(false);
    expect(knowledgeTools.some((name) => name.includes("automation"))).toBe(false);
    expect(knowledgeTools).not.toContain("list_pages");
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
        name: "get_knowledge_changes",
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
    const response = await mcpRequest(serverWith(pagesWithGuidance(), assets), {
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
    const response = await mcpRequest(serverWith(pagesWithGuidance(), assets), {
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
