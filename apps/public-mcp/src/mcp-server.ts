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
  getPage(path: string): Promise<PublicMcpPage | null>;
  searchPages(query: string, limit: number): Promise<PublicMcpSearchResult[]>;
};

export type PublicMessageWriter = {
  create(replyTo: string, message: string): Promise<{ id: string }>;
};

const jsonContent = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

function unavailable(operation: string, error: unknown, message = "The public context service is temporarily unavailable.") {
  console.error("public_mcp_operation_failed", {
    operation,
    error_type: error instanceof Error ? error.name : typeof error,
    ...error && typeof error === "object" && "code" in error
      ? { code: String((error as { code: unknown }).code) }
      : {},
  });
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: message }],
  };
}

const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const messageAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};

function isEmailOrPhone(value: string): boolean {
  if (z.string().email().safeParse(value).success) return true;
  if (!/^\+?[0-9 ().-]+$/.test(value)) return false;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

const replyToSchema = z.string()
  .trim()
  .min(3)
  .max(320)
  .refine(isEmailOrPhone, "Provide a valid email address or phone number")
  .describe("A loopback address where the owner can reach the sender: a valid email address or phone number.");

export function createPublicMcpServer(
  reader: PublicPageReader,
  messages: PublicMessageWriter,
  publicSiteOrigin: string,
): McpServer {
  const server = new McpServer({ name: "context-use-public", version: "0.1.25" }, {
    instructions: "Anonymous access to the owner's public pages. Call get_about_page first for the About page and complete hierarchical index, then get_public_page or search_public_pages as needed. The send_message tool can deliver confidential outreach to the owner, but messages can never be read through this server.",
  });

  server.registerTool("get_about_page", {
    description: "Start here. Return the owner's required public About page plus a complete hierarchical index of every public page.",
    inputSchema: z.object({}).strict(),
    annotations,
  }, async () => {
    try {
      const [pages, about] = await Promise.all([reader.listPages(), reader.getPage("about")]);
      return jsonContent({
        title: about?.title ?? "About",
        canonical_url: new URL("/p/about", publicSiteOrigin).href,
        introduction_markdown: about?.body_markdown ?? "",
        page_count: pages.length,
        pages: buildPublicPageTree(pages, publicSiteOrigin),
      });
    } catch (error) {
      return unavailable("get_about_page", error);
    }
  });

  server.registerTool("get_public_page", {
    description: "Read one public page by the knowledge path shown in get_about_page or search_public_pages. Returns its published hierarchy context and Markdown content.",
    inputSchema: z.object({
      path: z.string().min(1).max(512).regex(/^[a-z0-9][a-z0-9/_-]*$/)
        .refine((value) => !value.includes("//") && !value.endsWith("/")),
    }).strict(),
    annotations,
  }, async ({ path }) => {
    try {
      const [page, pages] = await Promise.all([reader.getPage(path), reader.listPages()]);
      if (!page) return jsonContent({ found: false });
      return jsonContent({
        found: true,
        page: {
          path: page.path,
          title: page.title,
          url: new URL(`/p/${page.path}`, publicSiteOrigin).href,
          breadcrumbs: publicBreadcrumbs(page.path, pages, publicSiteOrigin),
          children: publicChildren(page.path, pages, publicSiteOrigin),
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
          path: result.path,
          title: result.title,
          url: new URL(`/p/${result.path}`, publicSiteOrigin).href,
          breadcrumbs: publicBreadcrumbs(result.path, pages, publicSiteOrigin),
          excerpt_markdown: result.excerpt,
        })),
      });
    } catch (error) {
      return unavailable("search_public_pages", error);
    }
  });

  server.registerTool("send_message", {
    description: "Send a confidential message to the owner after reviewing their public context. A valid sender email or phone number is required so the owner can reply. The message is visible only in the authenticated owner dashboard and cannot be retrieved through this public MCP server.",
    inputSchema: z.object({
      message: z.string().trim().min(1).max(10_000).describe("The message for the owner, ideally grounded in the public context you reviewed."),
      reply_to: replyToSchema,
    }).strict(),
    annotations: messageAnnotations,
  }, async ({ message, reply_to }) => {
    try {
      const receipt = await messages.create(reply_to, message);
      return jsonContent({
        delivered: true,
        receipt_id: receipt.id,
        privacy: "The message can only be viewed by the authenticated owner.",
      });
    } catch (error) {
      return unavailable("send_message", error, "The message could not be delivered right now.");
    }
  });

  return server;
}
