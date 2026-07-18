import { describe, expect, test } from "bun:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PublicMessageWriter, PublicPageReader } from "./mcp-server.ts";
import { createPublicMcpServer } from "./mcp-server.ts";
import { createPublicMcpTransport } from "./transport.ts";

const summaries = [
  { slug: "home", title: "Home", parent_slug: null },
  { slug: "about", title: "About", parent_slug: null },
  { slug: "work", title: "Work", parent_slug: "about" },
  { slug: "context-use", title: "Context Use", parent_slug: "work" },
];

const reader: PublicPageReader = {
  async listPages() {
    return summaries;
  },
  async getPage(slug) {
    const page = summaries.find((candidate) => candidate.slug === slug);
    return page ? { ...page, body_markdown: `${page.title} public content` } : null;
  },
  async searchPages() {
    return [{ ...summaries[3]!, excerpt: "A **public** personal knowledge base" }];
  },
};

const deliveredMessages: Array<{ replyTo: string; message: string }> = [];
const messages: PublicMessageWriter = {
  async create(replyTo, message) {
    deliveredMessages.push({ replyTo, message });
    return { id: "0195f7c3-3f14-7ed1-95f7-93c91ee04e61" };
  },
};

const publicServer = () => createPublicMcpServer(reader, messages, "https://context.example.com");

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
  test("advertises the three public readers and confidential message delivery", async () => {
    const response = await mcpRequest(publicServer(), {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    });

    expect(response.result?.tools?.map(({ name }) => name)).toEqual([
      "get_main_page",
      "get_public_page",
      "search_public_pages",
      "send_message_to_owner",
    ]);
  });

  test("returns home content and a complete nested index from the main page", async () => {
    const response = await mcpRequest(publicServer(), {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "get_main_page", arguments: {} },
    });
    const result = parseContent(response) as {
      introduction_markdown: string;
      page_count: number;
      pages: Array<{ slug: string; children: Array<{ slug: string; children: Array<{ slug: string }> }> }>;
    };

    expect(result.introduction_markdown).toBe("Home public content");
    expect(result.page_count).toBe(4);
    expect(result.pages.find(({ slug }) => slug === "about")?.children[0]?.children[0]?.slug).toBe("context-use");
  });

  test("returns published breadcrumbs, children, and content for one page", async () => {
    const response = await mcpRequest(publicServer(), {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "get_public_page", arguments: { slug: "work" } },
    });
    const result = parseContent(response) as {
      page: { breadcrumbs: Array<{ slug: string }>; children: Array<{ slug: string }>; content_markdown: string };
    };

    expect(result.page.breadcrumbs.map(({ slug }) => slug)).toEqual(["about", "work"]);
    expect(result.page.children.map(({ slug }) => slug)).toEqual(["context-use"]);
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
      results: Array<{ slug: string; breadcrumbs: Array<{ slug: string }>; excerpt_markdown: string }>;
    };

    expect(result.results[0]).toMatchObject({
      slug: "context-use",
      excerpt_markdown: "A **public** personal knowledge base",
    });
    expect(result.results[0]?.breadcrumbs.map(({ slug }) => slug)).toEqual(["about", "work", "context-use"]);
  });

  test("requires a valid sender email or phone and returns no submitted content", async () => {
    deliveredMessages.length = 0;
    const invalid = await mcpRequest(publicServer(), {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "send_message_to_owner",
        arguments: { message: "I would like to discuss your work.", reply_to: "anonymous" },
      },
    });
    expect(invalid.result?.isError).toBe(true);
    expect(deliveredMessages).toEqual([]);

    const response = await mcpRequest(publicServer(), {
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        name: "send_message_to_owner",
        arguments: {
          message: "  Your context-use work overlaps with our research.  ",
          reply_to: "  sender@example.com  ",
        },
      },
    });
    const result = parseContent(response) as Record<string, unknown>;

    expect(deliveredMessages).toEqual([{
      replyTo: "sender@example.com",
      message: "Your context-use work overlaps with our research.",
    }]);
    expect(result).toEqual({
      delivered: true,
      receipt_id: "0195f7c3-3f14-7ed1-95f7-93c91ee04e61",
      privacy: "The message can only be viewed by the authenticated owner.",
    });
    expect(JSON.stringify(result)).not.toContain("sender@example.com");
    expect(JSON.stringify(result)).not.toContain("research");
  });

  test("accepts a phone number as the required loopback address", async () => {
    deliveredMessages.length = 0;
    const response = await mcpRequest(publicServer(), {
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: {
        name: "send_message_to_owner",
        arguments: { message: "Please call me.", reply_to: "+44 (0)20 7946 0958" },
      },
    });

    expect(response.result?.isError).not.toBe(true);
    expect(deliveredMessages[0]).toEqual({
      replyTo: "+44 (0)20 7946 0958",
      message: "Please call me.",
    });
  });

  test("does not echo database diagnostics through tool errors", async () => {
    const failing: PublicPageReader = {
      async listPages() { throw new Error("PRIVATE-CANARY database detail"); },
      async getPage() { throw new Error("PRIVATE-CANARY database detail"); },
      async searchPages() { throw new Error("PRIVATE-CANARY database detail"); },
    };
    const response = await mcpRequest(createPublicMcpServer(failing, messages, "https://context.example.com"), {
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: { name: "get_main_page", arguments: {} },
    });

    expect(response.result?.isError).toBe(true);
    expect(response.result?.content?.[0]?.text).toBe("The public context service is temporarily unavailable.");
    expect(JSON.stringify(response)).not.toContain("PRIVATE-CANARY");
  });

  test("does not expose message database failures", async () => {
    const failingMessages: PublicMessageWriter = {
      async create() { throw new Error("PRIVATE-MESSAGE-DATABASE-CANARY"); },
    };
    const response = await mcpRequest(
      createPublicMcpServer(reader, failingMessages, "https://context.example.com"),
      {
        jsonrpc: "2.0",
        id: 9,
        method: "tools/call",
        params: {
          name: "send_message_to_owner",
          arguments: { message: "Hello", reply_to: "sender@example.com" },
        },
      },
    );

    expect(response.result?.isError).toBe(true);
    expect(response.result?.content?.[0]?.text).toBe("The message could not be delivered right now.");
    expect(JSON.stringify(response)).not.toContain("PRIVATE-MESSAGE-DATABASE-CANARY");
  });
});
