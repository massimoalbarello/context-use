import { PublicRepository, createPool } from "@context-use/database";
import { AssetPath, DirectoryPath, PagePath } from "@context-use/shared";
import { Elysia } from "elysia";
import { config } from "./config.ts";
import { json, routeError } from "./http.ts";
import { renderMarkdown } from "./markdown.ts";
import { createPublicAssetContentHandler } from "./public-asset-content.ts";
import { renderLlmsFullTxt, renderLlmsTxt, renderPublicPageMarkdown } from "./public-llms.ts";
import {
  INTRO_PATH,
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

async function publicDirectoryResponse(rawPath: string): Promise<Response> {
  const parsedPath = DirectoryPath.safeParse(rawPath);
  if (!parsedPath.success) return new Response("Not found", { status: 404, headers: securityHeaders });
  const [index, introduction] = await Promise.all([
    publicData.directoryIndex(parsedPath.data),
    publicData.pageByPublicPath(INTRO_PATH),
  ]);
  if (!index) return new Response("Not found", { status: 404, headers: securityHeaders });
  const defaultPageHref = publicPageHref(index.default_page_path);
  if (defaultPageHref) {
    return new Response(null, {
      status: 302,
      headers: { ...securityHeaders, location: defaultPageHref },
    });
  }
  return new Response(renderPublicIndexDocument({
    ...index,
    siteOrigin: config.APP_ORIGIN,
    introduction,
  }), { headers: htmlHeaders });
}

async function publicLlmsResponse(full: boolean): Promise<Response> {
  const pages = await publicData.publishedPages();
  const options = { siteOrigin: config.APP_ORIGIN, assetOrigin: config.ASSET_ORIGIN };
  const content = full ? renderLlmsFullTxt(pages, options) : renderLlmsTxt(pages, options);
  return new Response(content, { headers: full ? agentTextHeaders : textHeaders });
}

async function publicSitemapResponse(): Promise<Response> {
  const pages = await publicData.publishedPages();
  return new Response(renderSitemapXml(pages, config.APP_ORIGIN), { headers: xmlHeaders });
}

async function optionalProfileLinks(): Promise<string[]> {
  const contacts = await publicData.pageByPublicPath(OPTIONAL_CONTACTS_PATH);
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
    const page = await publicData.pageByPublicPath(publicPath);
    if (!page && publicPath === INTRO_PATH && !markdown) {
      return new Response(renderPublicPageDocument(
        "Nothing published yet",
        "<p>The owner has not published an introduction yet. Please check back later.</p>",
        undefined,
        undefined,
        {
          siteOrigin: config.APP_ORIGIN,
          summary: "The owner has not published an introduction yet.",
          introduction: null,
          indexable: false,
          canonicalPath: `/p/${INTRO_PATH}`,
        },
      ), {
        headers: { ...securityHeaders, "content-type": "text/html; charset=utf-8" },
      });
    }
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
    const introduction = publicPath === INTRO_PATH
      ? page
      : await publicData.pageByPublicPath(INTRO_PATH);
    const profileLinks = publicPath === INTRO_PATH
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
      },
    ), { headers: htmlHeaders });
  })
  .get("/", async () => {
    const [introduction, profileLinks] = await Promise.all([
      publicData.pageByPublicPath(INTRO_PATH),
      optionalProfileLinks(),
    ]);
    return new Response(renderPublicLandingDocument({
      siteOrigin: config.APP_ORIGIN,
      introduction,
      profileLinks,
    }), { headers: htmlHeaders });
  })
  .get("/public.css", () => new Response(publicPageStyles, {
    headers: { ...securityHeaders, "content-type": "text/css; charset=utf-8" },
  }))
  .get("/content.css", () => new Response(IMAGE_LAYOUT_STYLES, {
    headers: { ...securityHeaders, "content-type": "text/css; charset=utf-8" },
  }));
