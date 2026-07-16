const UUID_PATTERN = "([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})";
const PAGE_LINK = new RegExp(`(?:!?)\\[[^\\]]*\\]\\(context-use:\\/\\/page\\/${UUID_PATTERN}\\)`, "gi");
const ASSET_LINK = new RegExp(`!\\[[^\\]]*\\]\\(context-use:\\/\\/asset\\/${UUID_PATTERN}\\)`, "gi");

export function extractPageLinks(markdown: string): string[] {
  return [...new Set(Array.from(markdown.matchAll(PAGE_LINK), (match) => match[1]!.toLowerCase()))];
}

export function extractAssetLinks(markdown: string): string[] {
  return [...new Set(Array.from(markdown.matchAll(ASSET_LINK), (match) => match[1]!.toLowerCase()))];
}
