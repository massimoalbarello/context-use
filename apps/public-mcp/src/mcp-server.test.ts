import { describe, expect, test } from "bun:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PublicPageReader } from "./mcp-server.ts";
import { createPublicMcpServer } from "./mcp-server.ts";
import { createPublicMcpTransport } from "./transport.ts";

const summaries = [
  { path: "home", title: "Home", parent_path: null },
  { path: "about/intro", title: "About", parent_path: null },
  { path: "work", title: "Work", parent_path: null },
  { path: "work/context-use", title: "Context Use", parent_path: "work" },
];

const reader: PublicPageReader = {
  async listPages() {
    return summaries;
  },
  async getPage(path) {
    const page = summaries.find((candidate) => candidate.path === path);
    return page ? { ...page, body_markdown: `${page.title} public content` } : null;
  },
  async searchPages() {
    return [{ ...summaries[3]!, excerpt: "A **public** personal knowledge base" }];
  },
};

const publicServer = () => createPublicMcpServer(reader, "https://context.example.com");

async function mcpRequest(server: McpServer, body: Record<string, unknown>) {
  const transport = createPublicMcpTransport();
  await server.connect(transport);
  try {
    const response = await transport.handleRequest(new Request("https://public.context.example.com/mcp", {
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
        tools?: Array<{ name: string }>;
        content?: Array<{ type: string; text: string }>;
        isError?: boolean;
      };
    };
  } finally {
    await transport.close();
    await server.close();
  }
}

function parseContent(response: Awaited<ReturnType<typeof mcpRequest>>): unknown {
  return JSON.parse(response.result?.content?.[0]?.text ?? "null");
}

describe("public MCP tools", () => {
  test("advertises only the three public readers", async () => {
    const response = await mcpRequest(publicServer(), {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    });

    expect(response.result?.tools?.map(({ name }) => name)).toEqual([
      "get_about_page",
      "get_public_page",
      "search_public_pages",
    ]);
  });

  test("returns optional about content and a complete nested index from the main page", async () => {
    const response = await mcpRequest(publicServer(), {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "get_about_page", arguments: {} },
    });
    const result = parseContent(response) as {
      canonical_url: string;
      introduction_markdown: string;
      page_count: number;
      pages: Array<{ path: string; children: Array<{ path: string; children: Array<{ path: string }> }> }>;
    };

    expect(result.canonical_url).toBe("https://context.example.com/p/about/intro");
    expect(result.introduction_markdown).toBe("About public content");
    expect(result.page_count).toBe(4);
    expect(result.pages.find(({ path }) => path === "work")?.children[0]?.path).toBe("work/context-use");
  });

  test("explains an unpublished introduction without requiring an about page", async () => {
    const emptyReader: PublicPageReader = {
      async listPages() { return []; },
      async getPage() { return null; },
      async searchPages() { return []; },
    };
    const response = await mcpRequest(createPublicMcpServer(emptyReader, "https://context.example.com"), {
      jsonrpc: "2.0",
      id: 20,
      method: "tools/call",
      params: { name: "get_about_page", arguments: {} },
    });

    expect(parseContent(response)).toMatchObject({
      published: false,
      canonical_url: "https://context.example.com/p/about/intro",
      page_count: 0,
    });
  });

  test("returns published breadcrumbs, children, and content for one page", async () => {
    const response = await mcpRequest(publicServer(), {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "get_public_page", arguments: { path: "work" } },
    });
    const result = parseContent(response) as {
      page: { breadcrumbs: Array<{ path: string }>; children: Array<{ path: string }>; content_markdown: string };
    };

    expect(result.page.breadcrumbs.map(({ path }) => path)).toEqual(["work"]);
    expect(result.page.children.map(({ path }) => path)).toEqual(["work/context-use"]);
    expect(result.page.content_markdown).toBe("Work public content");
  });

  test("searches only through the reader and enriches results with public hierarchy", async () => {
    const response = await mcpRequest(publicServer(), {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "search_public_pages", arguments: { query: "knowledge" } },
    });
    const result = parseContent(response) as {
      results: Array<{ path: string; breadcrumbs: Array<{ path: string }>; excerpt_markdown: string }>;
    };

    expect(result.results[0]).toMatchObject({
      path: "work/context-use",
      excerpt_markdown: "A **public** personal knowledge base",
    });
    expect(result.results[0]?.breadcrumbs.map(({ path }) => path)).toEqual(["work", "work/context-use"]);
  });

  test("does not echo database diagnostics through tool errors", async () => {
    const failing: PublicPageReader = {
      async listPages() { throw new Error("PRIVATE-CANARY database detail"); },
      async getPage() { throw new Error("PRIVATE-CANARY database detail"); },
      async searchPages() { throw new Error("PRIVATE-CANARY database detail"); },
    };
    const response = await mcpRequest(createPublicMcpServer(failing, "https://context.example.com"), {
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: { name: "get_about_page", arguments: {} },
    });

    expect(response.result?.isError).toBe(true);
    expect(response.result?.content?.[0]?.text).toBe("The public context service is temporarily unavailable.");
    expect(JSON.stringify(response)).not.toContain("PRIVATE-CANARY");
  });

});
