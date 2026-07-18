import type {
  PublicMcpPage,
  PublicMcpPageSummary,
  PublicMcpSearchResult,
} from "@context-use/database";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  buildPublicPageTree,
  publicBreadcrumbs,
  publicChildren,
} from "./hierarchy.ts";

export type PublicPageReader = {
  listPages(): Promise<PublicMcpPageSummary[]>;
  getPage(slug: string): Promise<PublicMcpPage | null>;
  searchPages(query: string, limit: number): Promise<PublicMcpSearchResult[]>;
};

const jsonContent = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

function unavailable(operation: string, error: unknown) {
  console.error("public_mcp_operation_failed", {
    operation,
    error_type: error instanceof Error ? error.name : typeof error,
    ...error && typeof error === "object" && "code" in error
      ? { code: String((error as { code: unknown }).code) }
      : {},
  });
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: "The public page service is temporarily unavailable." }],
  };
}

const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

export function createPublicMcpServer(reader: PublicPageReader, publicSiteOrigin: string): McpServer {
  const server = new McpServer({ name: "context-use-public", version: "0.1.13" }, {
    instructions: "Read-only access to intentionally published pages. Call get_main_page first for the complete hierarchical index, then get_public_page or search_public_pages as needed.",
  });

  server.registerTool("get_main_page", {
    description: "Start here. Return the public home page, when published, plus a complete hierarchical index of every public page.",
    inputSchema: z.object({}).strict(),
    annotations,
  }, async () => {
    try {
      const [pages, home] = await Promise.all([reader.listPages(), reader.getPage("home")]);
      return jsonContent({
        title: home?.title ?? "Public pages",
        canonical_url: home ? new URL("/p/home", publicSiteOrigin).href : publicSiteOrigin,
        introduction_markdown: home?.body_markdown ?? null,
        page_count: pages.length,
        pages: buildPublicPageTree(pages, publicSiteOrigin),
      });
    } catch (error) {
      return unavailable("get_main_page", error);
    }
  });

  server.registerTool("get_public_page", {
    description: "Read one public page by the slug shown in get_main_page or search_public_pages. Returns its published hierarchy context and Markdown content.",
    inputSchema: z.object({
      slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,159}$/),
    }).strict(),
    annotations,
  }, async ({ slug }) => {
    try {
      const [page, pages] = await Promise.all([reader.getPage(slug), reader.listPages()]);
      if (!page) return jsonContent({ found: false });
      return jsonContent({
        found: true,
        page: {
          slug: page.slug,
          title: page.title,
          url: new URL(`/p/${encodeURIComponent(page.slug)}`, publicSiteOrigin).href,
          breadcrumbs: publicBreadcrumbs(page.slug, pages, publicSiteOrigin),
          children: publicChildren(page.slug, pages, publicSiteOrigin),
          content_markdown: page.body_markdown,
        },
      });
    } catch (error) {
      return unavailable("get_public_page", error);
    }
  });

  server.registerTool("search_public_pages", {
    description: "Full-text search only the published page projection. Returns matching public excerpts and published-page breadcrumbs.",
    inputSchema: z.object({
      query: z.string().trim().min(1).max(500),
      limit: z.number().int().min(1).max(25).default(10),
    }).strict(),
    annotations,
  }, async ({ query, limit }) => {
    try {
      const [results, pages] = await Promise.all([reader.searchPages(query, limit), reader.listPages()]);
      return jsonContent({
        query,
        results: results.map((result) => ({
          slug: result.slug,
          title: result.title,
          url: new URL(`/p/${encodeURIComponent(result.slug)}`, publicSiteOrigin).href,
          breadcrumbs: publicBreadcrumbs(result.slug, pages, publicSiteOrigin),
          excerpt_markdown: result.excerpt,
        })),
      });
    } catch (error) {
      return unavailable("search_public_pages", error);
    }
  });

  return server;
}
