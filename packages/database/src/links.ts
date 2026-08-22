const UUID_PATTERN = "([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})";
const FRAGMENT_PATTERN = "(#[a-z0-9][a-z0-9_-]*)?";
const DOCUMENT_LINK = new RegExp(`(!?)\\[[^\\]\\n]*\\]\\(context-use:\\/\\/document\\/${UUID_PATTERN}${FRAGMENT_PATTERN}\\)`, "gi");
const PAGE_LINK = new RegExp(`(?<!!)\\[[^\\]\\n]*\\]\\(context-use:\\/\\/document\\/${UUID_PATTERN}${FRAGMENT_PATTERN}\\)`, "gi");
const DIRECTORY_LINK = new RegExp(`\\[[^\\]]*\\]\\(context-use:\\/\\/directory\\/${UUID_PATTERN}\\)`, "gi");
const ASSET_LINK = new RegExp(`!\\[[^\\]\\n]*\\]\\(context-use:\\/\\/document\\/${UUID_PATTERN}${FRAGMENT_PATTERN}\\)`, "gi");
const WIKI_LINK = /(?<!!)\[\[([a-z0-9][a-z0-9/_-]*)(?:#[a-z0-9][a-z0-9_-]*)?(?:\|([^\]\n]+))?\]\]/gi;
const LEGACY_PRIVATE_PAGE_LINK = new RegExp(
  `(\\[[^\\]\\n]*\\]\\()\\/app\\/pages\\/${UUID_PATTERN}${FRAGMENT_PATTERN}(\\))`,
  "gi",
);
const LEGACY_DOCUMENT_LINK = new RegExp(
  `(!?\\[[^\\]\\n]*\\]\\()context-use:\\/\\/(?:page|asset|document)\\/${UUID_PATTERN}${FRAGMENT_PATTERN}(\\))`,
  "gi",
);
const LEGACY_PRIVATE_DIRECTORY_LINK = new RegExp(
  `(\\[[^\\]\\n]*\\]\\()\\/app\\/directories\\/${UUID_PATTERN}(\\))`,
  "gi",
);

// Keep the application-side guard aligned with replace_document_links. Raw
// source persistence must not fail merely because its derived graph exceeds
// this bounded indexing contract.
export const MAX_DOCUMENT_LINKS_PER_REVISION = 100_000;

export type WikiLink = { path: string; label: string };

/**
 * Stored hypermedia refers to document identity, never to an operational
 * representation or presentation surface. Legacy page and asset schemes remain
 * readable for immutable revisions, while every new revision uses one URI.
 */
export function normalizeInternalDocumentLinks(markdown: string): string {
  return markdown.replace(
    LEGACY_PRIVATE_PAGE_LINK,
    (_match, prefix: string, id: string, fragment: string | undefined, suffix: string) => (
      `${prefix}context-use://document/${id.toLowerCase()}${fragment?.toLowerCase() ?? ""}${suffix}`
    ),
  ).replace(
    LEGACY_DOCUMENT_LINK,
    (_match, prefix: string, id: string, fragment: string | undefined, suffix: string) => (
      `${prefix}context-use://document/${id.toLowerCase()}${fragment?.toLowerCase() ?? ""}${suffix}`
    ),
  ).replace(
    LEGACY_PRIVATE_DIRECTORY_LINK,
    (_match, prefix: string, id: string, suffix: string) => `${prefix}context-use://directory/${id.toLowerCase()}${suffix}`,
  );
}

/** @deprecated Use normalizeInternalDocumentLinks. */
export function normalizeInternalPageLinks(markdown: string): string {
  return normalizeInternalDocumentLinks(markdown);
}

export function extractDocumentLinks(markdown: string): string[] {
  return [...new Set(Array.from(
    normalizeInternalDocumentLinks(markdown).matchAll(DOCUMENT_LINK),
    (match) => match[2]!.toLowerCase(),
  ))];
}

export function extractPageLinks(markdown: string): string[] {
  return [...new Set(Array.from(
    normalizeInternalDocumentLinks(markdown).matchAll(PAGE_LINK),
    (match) => match[1]!.toLowerCase(),
  ))];
}

export function extractDirectoryLinks(markdown: string): string[] {
  return [...new Set(Array.from(
    normalizeInternalDocumentLinks(markdown).matchAll(DIRECTORY_LINK),
    (match) => match[1]!.toLowerCase(),
  ))];
}

export function extractAssetLinks(markdown: string): string[] {
  return [...new Set(Array.from(
    normalizeInternalDocumentLinks(markdown).matchAll(ASSET_LINK),
    (match) => match[1]!.toLowerCase(),
  ))];
}

export function extractWikiLinks(markdown: string): WikiLink[] {
  const links = new Map<string, WikiLink>();
  for (const match of markdown.matchAll(WIKI_LINK)) {
    const path = match[1]!.toLowerCase();
    const label = match[2]?.trim() || path.split("/").at(-1) || path;
    if (!links.has(path)) links.set(path, { path, label });
  }
  return [...links.values()];
}

export function wikiLinkCandidatePaths(path: string, sourcePath: string): string[] {
  if (path.includes("/")) return [path];
  const parent = sourcePath.split("/").slice(0, -1).join("/");
  return parent ? [`${parent}/${path}`, path] : [path];
}
