import { mapConcurrently, PublicRepository, createPool } from "@context-use/database";
import { AssetPath, DirectoryPath, PagePath } from "@context-use/shared";
import { Elysia } from "elysia";
import { config } from "./config.ts";
import { json, routeError } from "./http.ts";
import { renderMarkdown } from "./markdown.ts";
import { createPublicAssetContentHandler } from "./public-asset-content.ts";
import { renderLlmsFullTxt, renderLlmsTxt, renderPublicPageMarkdown } from "./public-llms.ts";
import {
  OPTIONAL_CONTACTS_PATH,
  externalProfileLinks,
  renderRobotsTxt,
  renderSitemapXml,
} from "./public-discovery.ts";
import {
  IMAGE_LAYOUT_STYLES,
  publicPageStyles,
  publicPageHref,
  renderPublicIndexDocument,
  renderPublicLandingDocument,
  renderPublicPageDocument,
} from "./public-page.ts";
import { securityHeaders } from "./security.ts";
import { BrokeredStorage } from "./storage-client.ts";

const pool = createPool(config.PUBLIC_DATABASE_URL, { application_name: "context-use-public-web" });
const publicData = new PublicRepository(pool);
const storage = new BrokeredStorage({
  socketPath: config.STORAGE_SOCKET_PATH,
  token: config.STORAGE_PUBLIC_TOKEN,
  publicOnly: true,
});
const publicAssetContent = createPublicAssetContentHandler(publicData, storage, config.ASSET_ORIGIN);
const htmlHeaders = { ...securityHeaders, "content-type": "text/html; charset=utf-8" };
const textHeaders = { ...securityHeaders, "content-type": "text/plain; charset=utf-8" };
const agentTextHeaders = { ...textHeaders, "x-robots-tag": "noindex, follow" };
const markdownHeaders = {
  ...securityHeaders,
  "content-type": "text/markdown; charset=utf-8",
  "x-robots-tag": "noindex, follow",
};
const xmlHeaders = { ...securityHeaders, "content-type": "application/xml; charset=utf-8" };
const unavailableResolvers = {
  page: async () => ({ available: false as const }),
  directory: async () => ({ available: false as const }),
  pagePath: async () => ({ available: false as const }),
  asset: async () => ({ available: false as const }),
  publicAssetPath: async (path: string) => {
    const parsed = AssetPath.safeParse(path);
    if (!parsed.success) return { available: false as const };
    const asset = await publicData.assetByPublicPath(parsed.data);
    return asset
      ? {
          available: true as const,
          href: `${config.ASSET_ORIGIN}/a/${asset.public_path}`,
          contentType: asset.content_type,
        }
      : { available: false as const };
  },
};

async function publishedPage(path: string) {
  const page = await publicData.pageByPublicPath(path);
  if (!page) return null;
  return { ...page, body_markdown: await storage.readPublishedDocument(page.public_path) };
}

async function publishedPages() {
  const pages = await publicData.publishedPages();
  return mapConcurrently(pages, 8, async (page) => ({
    ...page,
    body_markdown: await storage.readPublishedDocument(page.public_path),
  }));
}

async function publicEntrypoint() {
  const settings = await publicData.settings();
  const introduction = settings.entrypoint_public_path
    ? await publishedPage(settings.entrypoint_public_path)
    : null;
  return { settings, introduction };
}

async function publicDirectoryResponse(rawPath: string): Promise<Response> {
  const parsedPath = DirectoryPath.safeParse(rawPath);
  if (!parsedPath.success) return new Response("Not found", { status: 404, headers: securityHeaders });
  const [index, entrypoint] = await Promise.all([
    publicData.directoryIndex(parsedPath.data),
    publicEntrypoint(),
  ]);
  if (!index && parsedPath.data !== "") {
    return new Response("Not found", { status: 404, headers: securityHeaders });
  }
  const renderedIndex = index ?? {
    path: "",
    title: "Knowledge",
    summary: "No knowledge has been published yet.",
    default_page_path: null,
    entries: [],
  };
  const defaultPageHref = publicPageHref(renderedIndex.default_page_path);
  if (defaultPageHref) {
    return new Response(null, {
      status: 302,
      headers: { ...securityHeaders, location: defaultPageHref },
    });
  }
  return new Response(renderPublicIndexDocument({
    ...renderedIndex,
    siteOrigin: config.APP_ORIGIN,
    introduction: entrypoint.introduction,
    entrypointPublicPath: entrypoint.settings.entrypoint_public_path,
  }), { headers: htmlHeaders });
}

async function publicLlmsResponse(full: boolean): Promise<Response> {
  const [pages, settings] = await Promise.all([
    full ? publishedPages() : publicData.publishedPages(),
    publicData.settings(),
  ]);
  const options = {
    siteOrigin: config.APP_ORIGIN,
    assetOrigin: config.ASSET_ORIGIN,
    entrypointPublicPath: settings.entrypoint_public_path,
  };
  const content = full ? renderLlmsFullTxt(pages, options) : renderLlmsTxt(pages, options);
  return new Response(content, { headers: full ? agentTextHeaders : textHeaders });
}

async function publicSitemapResponse(): Promise<Response> {
  const pages = await publicData.publishedPages();
  return new Response(renderSitemapXml(pages, config.APP_ORIGIN), { headers: xmlHeaders });
}

async function optionalProfileLinks(): Promise<string[]> {
  const contacts = await publishedPage(OPTIONAL_CONTACTS_PATH);
  return contacts
    ? externalProfileLinks(contacts.body_markdown, config.APP_ORIGIN)
    : [];
}

export const publicApp = new Elysia({ strictPath: true })
  .onError(({ error, code }) => code === "NOT_FOUND"
    ? new Response("Not found", { status: 404, headers: securityHeaders })
    : routeError(error))
  .get("/health", () => json({ status: "ok", service: "public-web" }))
  .get("/a/*", ({ request, params }) => publicAssetContent(request, params["*"]))
  .get("/robots.txt", () => new Response(renderRobotsTxt(config.APP_ORIGIN), { headers: textHeaders }))
  .get("/sitemap.xml", () => publicSitemapResponse())
  .get("/llms.txt", () => publicLlmsResponse(false))
  .get("/llms-full.txt", () => publicLlmsResponse(true))
  .get("/p", () => new Response(null, {
    status: 308,
    headers: { ...securityHeaders, location: "/p/" },
  }))
  .get("/p/*", async ({ params }) => {
    const rawPath = params["*"];
    if (rawPath === "") return publicDirectoryResponse("");
    if (rawPath.endsWith("/")) return publicDirectoryResponse(rawPath.slice(0, -1));
    const markdown = rawPath.endsWith(".md");
    const parsedPath = PagePath.safeParse(markdown ? rawPath.slice(0, -3) : rawPath);
    if (!parsedPath.success) return new Response("Not found", { status: 404, headers: securityHeaders });
    const publicPath = parsedPath.data;
    const page = await publishedPage(publicPath);
    if (!page) {
      if (markdown) return new Response("Not found", { status: 404, headers: securityHeaders });
      const index = await publicData.directoryIndex(publicPath);
      if (!index) return new Response("Not found", { status: 404, headers: securityHeaders });
      const defaultPageHref = publicPageHref(index.default_page_path);
      return new Response(null, {
        status: defaultPageHref ? 302 : 308,
        headers: {
          ...securityHeaders,
          location: defaultPageHref ?? `/p/${publicPath}/`,
        },
      });
    }
    if (markdown) {
      return new Response(renderPublicPageMarkdown(page, {
        siteOrigin: config.APP_ORIGIN,
        assetOrigin: config.ASSET_ORIGIN,
      }), {
        headers: {
          ...markdownHeaders,
          link: `<${config.APP_ORIGIN}/p/${page.public_path}>; rel="canonical"`,
        },
      });
    }
    const settings = await publicData.settings();
    const introduction = publicPath === settings.entrypoint_public_path
      ? page
      : settings.entrypoint_public_path
        ? await publishedPage(settings.entrypoint_public_path)
        : null;
    const profileLinks = publicPath === settings.entrypoint_public_path
      ? await optionalProfileLinks()
      : undefined;
    // The database projection has already removed every private identifier and
    // replaced independently public targets with public paths. The renderer can
    // resolve a published asset path but has no UUID/private-path capability.
    const content = await renderMarkdown(page.body_markdown, unavailableResolvers);
    return new Response(renderPublicPageDocument(
      page.title,
      content,
      page.public_path,
      page.last_edited_at,
      {
        siteOrigin: config.APP_ORIGIN,
        summary: page.summary,
        introduction,
        profileLinks,
        entrypointPublicPath: settings.entrypoint_public_path,
      },
    ), { headers: htmlHeaders });
  })
  .get("/", async () => {
    const [entrypoint, profileLinks] = await Promise.all([
      publicEntrypoint(),
      optionalProfileLinks(),
    ]);
    return new Response(renderPublicLandingDocument({
      siteOrigin: config.APP_ORIGIN,
      introduction: entrypoint.introduction,
      entrypointPublicPath: entrypoint.settings.entrypoint_public_path,
      profileLinks,
    }), { headers: htmlHeaders });
  })
  .get("/public.css", () => new Response(publicPageStyles, {
    headers: { ...securityHeaders, "content-type": "text/css; charset=utf-8" },
  }))
  .get("/content.css", () => new Response(IMAGE_LAYOUT_STYLES, {
    headers: { ...securityHeaders, "content-type": "text/css; charset=utf-8" },
  }));
