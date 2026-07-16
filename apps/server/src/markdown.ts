import { extractAssetLinks, extractPageLinks } from "@context-use/database";
import { marked } from "marked";
import sanitizeHtml from "sanitize-html";
import { config } from "./config.ts";

export type LinkResolution = { available: true; href: string } | { available: false };
export type MarkdownResolvers = {
  page: (id: string) => Promise<LinkResolution>;
  asset: (id: string) => Promise<LinkResolution>;
};

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export async function renderMarkdown(markdown: string, resolvers: MarkdownResolvers): Promise<string> {
  const pages = new Map<string, LinkResolution>();
  const assets = new Map<string, LinkResolution>();
  await Promise.all(extractPageLinks(markdown).map(async (id) => pages.set(id, await resolvers.page(id))));
  await Promise.all(extractAssetLinks(markdown).map(async (id) => assets.set(id, await resolvers.asset(id))));

  let source = markdown.replace(
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
      return target?.available
        ? `![${label}](${target.href})`
        : `<span class="private-reference">Private asset unavailable</span>`;
    },
  );

  const unsafe = await marked.parse(source, { gfm: true, breaks: false, async: true });
  return sanitizeHtml(unsafe, {
    allowedTags: [
      "p", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote",
      "ul", "ol", "li", "strong", "em", "del", "code", "pre", "a", "span",
      "table", "thead", "tbody", "tr", "th", "td", "img",
    ],
    allowedAttributes: {
      a: ["href", "rel", "target"],
      span: ["class"],
      code: ["class"],
      img: ["src", "alt", "title", "loading"],
      th: ["align"],
      td: ["align"],
    },
    allowedClasses: { span: ["private-reference"] },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: {
      a: (_tag, attributes) => ({
        tagName: "a",
        attribs: { ...attributes, rel: "noopener noreferrer", target: "_blank" },
      }),
      img: (_tag, attributes) => ({
        tagName: "img",
        attribs: { ...attributes, loading: "lazy" },
      }),
    },
    exclusiveFilter: (frame) => {
      if (frame.tag !== "img") return false;
      const src = frame.attribs.src ?? "";
      return !(src.startsWith(config.ASSET_ORIGIN) || src.startsWith("/api/dashboard/assets/"));
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
  const privateReferences = extractPageLinks(markdown).length + extractAssetLinks(markdown).length;
  if (privateReferences) warnings.push(`${privateReferences} context-use reference(s) have independent visibility`);
  return warnings;
}
