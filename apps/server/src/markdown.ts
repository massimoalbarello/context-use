import { randomUUID } from "node:crypto";
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
  publicAssetPath?: (path: string) => Promise<AssetResolution>;
};

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

type ImageFormatting = {
  size: "small" | "medium" | "large" | "full";
  align: "left" | "center" | "right";
  shape: "auto" | "square" | "portrait" | "landscape";
  layout: "block" | "half" | "third";
};

const IMAGE_FORMAT_VALUES = {
  size: new Set<ImageFormatting["size"]>(["small", "medium", "large", "full"]),
  align: new Set<ImageFormatting["align"]>(["left", "center", "right"]),
  shape: new Set<ImageFormatting["shape"]>(["auto", "square", "portrait", "landscape"]),
  layout: new Set<ImageFormatting["layout"]>(["block", "half", "third"]),
};

function parseImageFormatting(raw: string): ImageFormatting | null {
  const formatting: ImageFormatting = { size: "medium", align: "center", shape: "auto", layout: "block" };
  const seen = new Set<string>();
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;
  for (const token of tokens) {
    const match = /^([a-z]+)=([a-z]+)$/.exec(token);
    if (!match) return null;
    const [, key, value] = match;
    if (!key || !value || seen.has(key) || !(key in IMAGE_FORMAT_VALUES)) return null;
    const allowed = IMAGE_FORMAT_VALUES[key as keyof typeof IMAGE_FORMAT_VALUES] as ReadonlySet<string>;
    if (!allowed.has(value)) return null;
    seen.add(key);
    (formatting as unknown as Record<string, string>)[key] = value;
  }
  return formatting;
}

function formattedImageHtml(label: string, href: string, formatting: ImageFormatting): string {
  const classes = [
    "cu-image",
    `cu-image--size-${formatting.size}`,
    `cu-image--align-${formatting.align}`,
    `cu-image--shape-${formatting.shape}`,
    `cu-image--layout-${formatting.layout}`,
  ].join(" ");
  return `<span class="${classes}"><img src="${escapeHtml(href)}" alt="${escapeHtml(label)}" loading="lazy"></span>`;
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
    if (/^\/p\/[a-z0-9][a-z0-9\/_-]*$/i.test(url.pathname)) {
      return url.origin === assetOrigin;
    }
    return false;
  } catch {
    return false;
  }
}

function renderAssetReference(
  label: string,
  target: AssetResolution | undefined,
  rawFormatting: string | undefined,
  formattedImages: Map<string, string>,
): string {
  if (!target?.available) return `<span class="private-reference">Private asset unavailable</span>`;
  const kind = assetRenderKind(target.contentType);
  if (kind === "image") {
    if (rawFormatting === undefined) return `![${label}](${target.href})`;
    const formatting = parseImageFormatting(rawFormatting);
    if (!formatting) return `![${label}](${target.href}){${rawFormatting}}`;
    if (!isAllowedAssetSource(target.href)) return `<span class="private-reference">Private asset unavailable</span>`;
    const placeholder = `CUIMAGE${randomUUID().replaceAll("-", "")}${formattedImages.size}`;
    formattedImages.set(placeholder, formattedImageHtml(label, target.href, formatting));
    return placeholder;
  }
  if (kind === "video") {
    const accessibleLabel = label.trim() || "Embedded video";
    return `<video src="${escapeHtml(target.href)}" controls preload="metadata" aria-label="${escapeHtml(accessibleLabel)}">${escapeHtml(accessibleLabel)}</video>`;
  }
  const linkLabel = label.trim() || (target.contentType.toLowerCase() === "application/pdf" ? "Open PDF" : "Open asset");
  return `<a href="${escapeHtml(target.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(linkLabel)}</a>`;
}

export async function renderMarkdown(markdown: string, resolvers: MarkdownResolvers): Promise<string> {
  // Old page versions can contain dashboard URLs. Convert them before any
  // resolution so public output never carries a private route or page UUID.
  const normalizedMarkdown = normalizeInternalPageLinks(markdown);
  const pages = new Map<string, LinkResolution>();
  const wikiPages = new Map<string, LinkResolution>();
  const assets = new Map<string, AssetResolution>();
  const publicAssets = new Map<string, AssetResolution>();
  const formattedImages = new Map<string, string>();
  await Promise.all(extractPageLinks(normalizedMarkdown).map(async (id) => pages.set(id, await resolvers.page(id))));
  await Promise.all(extractWikiLinks(normalizedMarkdown).map(async ({ path }) => wikiPages.set(path, await resolvers.pagePath(path))));
  await Promise.all(extractAssetLinks(normalizedMarkdown).map(async (id) => assets.set(id, await resolvers.asset(id))));
  const publicAssetPaths = [...normalizedMarkdown.matchAll(
    /context-use:\/\/public-asset\/([a-z0-9][a-z0-9/_-]*)/gi,
  )].map((match) => match[1]!.toLowerCase());
  await Promise.all([...new Set(publicAssetPaths)].map(async (path) => publicAssets.set(
    path,
    await (resolvers.publicAssetPath?.(path) ?? Promise.resolve({ available: false as const })),
  )));

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
    /!\[([^\]\n]*)\]\(context-use:\/\/asset\/([0-9a-f-]{36})\)(?:\{([^}\n]+)\})?/gi,
    (_match, label: string, id: string, rawFormatting: string | undefined) => {
      return renderAssetReference(label, assets.get(id.toLowerCase()), rawFormatting, formattedImages);
    },
  );
  source = source.replace(
    /!\[([^\]\n]*)\]\(context-use:\/\/public-asset\/([a-z0-9][a-z0-9/_-]*)\)(?:\{([^}\n]+)\})?/gi,
    (_match, label: string, path: string, rawFormatting: string | undefined) => renderAssetReference(
      label,
      publicAssets.get(path.toLowerCase()),
      rawFormatting,
      formattedImages,
    ),
  );
  source = source.replace(
    /(?<!!)\[\[([a-z0-9][a-z0-9/_-]*)(?:\|([^\]\n]+))?\]\]/gi,
    (_match, rawPath: string, rawLabel: string | undefined) => {
      const path = rawPath.toLowerCase();
      const target = wikiPages.get(path);
      const label = rawLabel?.trim()
        || (target?.available ? path.split("/").at(-1) || "Published page" : "Private page");
      return target?.available
        ? `<a href="${escapeHtml(target.href)}">${escapeHtml(label)}</a>`
        : `<span class="private-reference">${escapeHtml(label)}</span>`;
    },
  );

  // Defense in depth for malformed or raw stable references outside a
  // recognized Markdown construct. Canonical routes produced by successful
  // private resolvers must remain intact; the public database projection
  // separately removes legacy dashboard and asset routes before public code
  // can read them.
  source = source.replace(
    /context-use:\/\/(?:page|asset)\/[0-9a-f-]{36}/gi,
    '<span class="private-reference">Private reference</span>',
  );

  const unsafe = await marked.parse(source, { gfm: true, breaks: false, async: true });
  const sanitized = sanitizeHtml(unsafe, {
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
  return [...formattedImages].reduce(
    (html, [placeholder, image]) => html.replaceAll(placeholder, image),
    sanitized,
  );
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
