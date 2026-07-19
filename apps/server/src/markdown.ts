import {
  extractAssetLinks,
  extractPageLinks,
  extractWikiLinks,
  normalizeInternalPageLinks,
} from "@context-use/database";
import { marked } from "marked";
import sanitizeHtml from "sanitize-html";
import { config } from "./config.ts";

export type LinkResolution = { available: true; href: string } | { available: false };
export type AssetResolution = { available: true; href: string; contentType: string } | { available: false };
export type MarkdownResolvers = {
  page: (id: string) => Promise<LinkResolution>;
  pagePath: (path: string) => Promise<LinkResolution>;
  asset: (id: string) => Promise<AssetResolution>;
};

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

type AssetRenderKind = "image" | "video" | "link";

function assetRenderKind(contentType: string): AssetRenderKind {
  const normalized = contentType.split(";", 1)[0]!.trim().toLowerCase();
  if (/^image\/(?:png|jpeg|gif|webp|avif)$/.test(normalized)) return "image";
  if (/^video\/(?:mp4|webm|quicktime)$/.test(normalized)) return "video";
  return "link";
}

function isAllowedAssetSource(src: string): boolean {
  if (!src) return false;
  try {
    const url = new URL(src, config.APP_ORIGIN);
    const appOrigin = new URL(config.APP_ORIGIN).origin;
    const assetOrigin = new URL(config.ASSET_ORIGIN).origin;
    if (/^\/api\/dashboard\/assets\/[0-9a-f-]{36}\/content$/i.test(url.pathname)) {
      return url.origin === appOrigin;
    }
    if (/^\/api\/public\/assets\/[0-9a-f-]{36}\/content$/i.test(url.pathname)) {
      return url.origin === assetOrigin;
    }
    return false;
  } catch {
    return false;
  }
}

export async function renderMarkdown(markdown: string, resolvers: MarkdownResolvers): Promise<string> {
  // Old page versions can contain dashboard URLs. Convert them before any
  // resolution so public output never carries a private route or page UUID.
  const normalizedMarkdown = normalizeInternalPageLinks(markdown);
  const pages = new Map<string, LinkResolution>();
  const wikiPages = new Map<string, LinkResolution>();
  const assets = new Map<string, AssetResolution>();
  await Promise.all(extractPageLinks(normalizedMarkdown).map(async (id) => pages.set(id, await resolvers.page(id))));
  await Promise.all(extractWikiLinks(normalizedMarkdown).map(async ({ path }) => wikiPages.set(path, await resolvers.pagePath(path))));
  await Promise.all(extractAssetLinks(normalizedMarkdown).map(async (id) => assets.set(id, await resolvers.asset(id))));

  let source = normalizedMarkdown.replace(
    /\[([^\]]*)\]\(context-use:\/\/page\/([0-9a-f-]{36})\)/gi,
    (_match, label: string, id: string) => {
      const target = pages.get(id.toLowerCase());
      return target?.available
        ? `[${label}](${target.href})`
        : `<span class="private-reference">${escapeHtml(label || "Private page")}</span>`;
    },
  );
  source = source.replace(
    /!\[([^\]]*)\]\(context-use:\/\/asset\/([0-9a-f-]{36})\)/gi,
    (_match, label: string, id: string) => {
      const target = assets.get(id.toLowerCase());
      if (!target?.available) return `<span class="private-reference">Private asset unavailable</span>`;
      const kind = assetRenderKind(target.contentType);
      if (kind === "image") return `![${label}](${target.href})`;
      if (kind === "video") {
        const accessibleLabel = label.trim() || "Embedded video";
        return `<video src="${escapeHtml(target.href)}" controls preload="metadata" aria-label="${escapeHtml(accessibleLabel)}">${escapeHtml(accessibleLabel)}</video>`;
      }
      const linkLabel = label.trim() || (target.contentType.toLowerCase() === "application/pdf" ? "Open PDF" : "Open asset");
      return `<a href="${escapeHtml(target.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(linkLabel)}</a>`;
    },
  );
  source = source.replace(
    /(?<!!)\[\[([a-z0-9][a-z0-9/_-]*)(?:\|([^\]\n]+))?\]\]/gi,
    (_match, rawPath: string, rawLabel: string | undefined) => {
      const path = rawPath.toLowerCase();
      const label = rawLabel?.trim() || path.split("/").at(-1) || path;
      const target = wikiPages.get(path);
      return target?.available
        ? `<a href="${escapeHtml(target.href)}">${escapeHtml(label)}</a>`
        : `<span class="private-reference">${escapeHtml(label)}</span>`;
    },
  );

  const unsafe = await marked.parse(source, { gfm: true, breaks: false, async: true });
  return sanitizeHtml(unsafe, {
    allowedTags: [
      "p", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote",
      "ul", "ol", "li", "strong", "em", "del", "code", "pre", "a", "span",
      "table", "thead", "tbody", "tr", "th", "td", "img", "video", "audio", "source",
    ],
    allowedAttributes: {
      a: ["href", "rel", "target"],
      span: ["class"],
      code: ["class"],
      img: ["src", "alt", "title", "loading"],
      video: ["src", "controls", "preload", "aria-label", "playsinline"],
      audio: ["src", "controls", "preload", "aria-label"],
      source: ["src", "type"],
      th: ["align"],
      td: ["align"],
    },
    allowedClasses: { span: ["private-reference"] },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: {
      a: (_tag, attributes) => {
        const external = /^(?:https?:|mailto:)/i.test(attributes.href ?? "");
        return {
          tagName: "a",
          attribs: external
            ? { ...attributes, rel: "noopener noreferrer", target: "_blank" }
            : attributes,
        };
      },
      img: (_tag, attributes) => ({
        tagName: "img",
        attribs: { ...attributes, loading: "lazy" },
      }),
      video: (_tag, attributes) => ({
        tagName: "video",
        attribs: { ...attributes, controls: "", preload: "metadata" },
      }),
      audio: (_tag, attributes) => ({
        tagName: "audio",
        attribs: { ...attributes, controls: "", preload: "metadata" },
      }),
    },
    exclusiveFilter: (frame) => {
      if (!(["img", "video", "audio", "source"] as string[]).includes(frame.tag)) return false;
      const src = frame.attribs.src ?? "";
      if (!src && (frame.tag === "video" || frame.tag === "audio")) return false;
      return !isAllowedAssetSource(src);
    },
  });
}

export function publicationWarnings(markdown: string): string[] {
  const warnings: string[] = [];
  const externalUrls = markdown.match(/https?:\/\/[^\s)>]+/g) ?? [];
  if (externalUrls.length) warnings.push(`${externalUrls.length} external URL(s) will become public`);
  if (/(?:BEGIN (?:RSA |EC )?PRIVATE KEY|api[_-]?key\s*[:=]|secret\s*[:=]|bearer\s+[a-z0-9._-]{16,})/i.test(markdown)) {
    warnings.push("Possible secret material detected; review the page carefully");
  }
  const privateReferences = extractPageLinks(markdown).length
    + extractWikiLinks(markdown).length
    + extractAssetLinks(markdown).length;
  if (privateReferences) warnings.push(`${privateReferences} context-use reference(s) have independent visibility`);
  return warnings;
}
