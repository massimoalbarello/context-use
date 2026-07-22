import { PublicRepository, createPool } from "@context-use/database";
import { AssetPath, DirectoryPath, PagePath } from "@context-use/shared";
import { Elysia } from "elysia";
import { config } from "./config.ts";
import { json, routeError } from "./http.ts";
import { renderMarkdown } from "./markdown.ts";
import { createPublicAssetContentHandler } from "./public-asset-content.ts";
import {
  IMAGE_LAYOUT_STYLES,
  publicPageStyles,
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
  const index = await publicData.directoryIndex(parsedPath.data);
  if (!index) return new Response("Not found", { status: 404, headers: securityHeaders });
  return new Response(renderPublicIndexDocument(index), { headers: htmlHeaders });
}

export const publicApp = new Elysia()
  .onError(({ error, code }) => code === "NOT_FOUND"
    ? new Response("Not found", { status: 404, headers: securityHeaders })
    : routeError(error))
  .get("/health", () => json({ status: "ok", service: "public-web" }))
  .get("/a/*", ({ request, params }) => publicAssetContent(request, params["*"]))
  .get("/p/*", async ({ params }) => {
    const parsedPath = PagePath.safeParse(params["*"]);
    if (!parsedPath.success) return new Response("Not found", { status: 404, headers: securityHeaders });
    const publicPath = parsedPath.data;
    const page = await publicData.pageByPublicPath(publicPath);
    if (!page && publicPath === "about/intro") {
      return new Response(renderPublicPageDocument(
        "Nothing published yet",
        "<p>The owner has not published an introduction yet. Please check back later.</p>",
      ), {
        headers: { ...securityHeaders, "content-type": "text/html; charset=utf-8" },
      });
    }
    if (!page) return new Response("Not found", { status: 404, headers: securityHeaders });
    // The database projection has already removed every private identifier and
    // replaced independently public targets with public paths. The renderer can
    // resolve a published asset path but has no UUID/private-path capability.
    const content = await renderMarkdown(page.body_markdown, unavailableResolvers);
    return new Response(renderPublicPageDocument(page.title, content, page.public_path, page.last_edited_at), { headers: htmlHeaders });
  })
  .get("/i", () => publicDirectoryResponse(""))
  .get("/i/*", ({ params }) => publicDirectoryResponse(params["*"]))
  .get("/", () => new Response(renderPublicLandingDocument(), {
    headers: htmlHeaders,
  }))
  .get("/public.css", () => new Response(publicPageStyles, {
    headers: { ...securityHeaders, "content-type": "text/css; charset=utf-8" },
  }))
  .get("/content.css", () => new Response(IMAGE_LAYOUT_STYLES, {
    headers: { ...securityHeaders, "content-type": "text/css; charset=utf-8" },
  }));
