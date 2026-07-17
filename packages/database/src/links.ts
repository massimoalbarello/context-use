const UUID_PATTERN = "([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})";
const PAGE_LINK = new RegExp(`(?:!?)\\[[^\\]]*\\]\\(context-use:\\/\\/page\\/${UUID_PATTERN}\\)`, "gi");
const ASSET_LINK = new RegExp(`!\\[[^\\]]*\\]\\(context-use:\\/\\/asset\\/${UUID_PATTERN}\\)`, "gi");
const WIKI_LINK = /(?<!!)\[\[([a-z0-9][a-z0-9/_-]*)(?:\|([^\]\n]+))?\]\]/gi;

export type WikiLink = { path: string; label: string };

export function extractPageLinks(markdown: string): string[] {
  return [...new Set(Array.from(markdown.matchAll(PAGE_LINK), (match) => match[1]!.toLowerCase()))];
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
