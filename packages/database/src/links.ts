const UUID_PATTERN = "([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})";
const PAGE_LINK = new RegExp(`(?:!?)\\[[^\\]]*\\]\\(context-use:\\/\\/page\\/${UUID_PATTERN}\\)`, "gi");
const DIRECTORY_LINK = new RegExp(`\\[[^\\]]*\\]\\(context-use:\\/\\/directory\\/${UUID_PATTERN}\\)`, "gi");
const ASSET_LINK = new RegExp(`!\\[[^\\]]*\\]\\(context-use:\\/\\/asset\\/${UUID_PATTERN}\\)`, "gi");
const WIKI_LINK = /(?<!!)\[\[([a-z0-9][a-z0-9/_-]*)(?:\|([^\]\n]+))?\]\]/gi;
const LEGACY_PRIVATE_PAGE_LINK = new RegExp(
  `(\\[[^\\]\\n]*\\]\\()\\/app\\/pages\\/${UUID_PATTERN}(\\))`,
  "gi",
);
const LEGACY_PRIVATE_DIRECTORY_LINK = new RegExp(
  `(\\[[^\\]\\n]*\\]\\()\\/app\\/directories\\/${UUID_PATTERN}(\\))`,
  "gi",
);

export type WikiLink = { path: string; label: string };

/**
 * Stored knowledge must refer to page identity, never to one presentation
 * surface. Keep accepting old dashboard URLs so immutable published versions
 * render safely, and canonicalize all new versions at the repository boundary.
 */
export function normalizeInternalPageLinks(markdown: string): string {
  return markdown.replace(
    LEGACY_PRIVATE_PAGE_LINK,
    (_match, prefix: string, id: string, suffix: string) => `${prefix}context-use://page/${id.toLowerCase()}${suffix}`,
  ).replace(
    LEGACY_PRIVATE_DIRECTORY_LINK,
    (_match, prefix: string, id: string, suffix: string) => `${prefix}context-use://directory/${id.toLowerCase()}${suffix}`,
  );
}

export function extractPageLinks(markdown: string): string[] {
  return [...new Set(Array.from(normalizeInternalPageLinks(markdown).matchAll(PAGE_LINK), (match) => match[1]!.toLowerCase()))];
}

export function extractDirectoryLinks(markdown: string): string[] {
  return [...new Set(Array.from(normalizeInternalPageLinks(markdown).matchAll(DIRECTORY_LINK), (match) => match[1]!.toLowerCase()))];
}

export function extractAssetLinks(markdown: string): string[] {
  return [...new Set(Array.from(markdown.matchAll(ASSET_LINK), (match) => match[1]!.toLowerCase()))];
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
