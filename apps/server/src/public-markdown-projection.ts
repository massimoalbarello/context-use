import { wikiLinkCandidatePaths, type PublicProjectionSnapshot } from "@context-use/database";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

function replacementLabel(label: string, fallback: string): string {
  return label.trim() || fallback;
}

export function projectPublicMarkdown(
  markdown: string,
  sourcePath: string,
  snapshot: Pick<PublicProjectionSnapshot, "pageTargets" | "assetTargets" | "directoryTargets">,
): string {
  const pagesById = new Map(snapshot.pageTargets.map((page) => [page.id.toLowerCase(), page]));
  const pagesBySourcePath = new Map(snapshot.pageTargets.map((page) => [page.source_path.toLowerCase(), page]));
  const assetsById = new Map(snapshot.assetTargets.map((asset) => [asset.id.toLowerCase(), asset]));
  const directoriesById = new Map(snapshot.directoryTargets.map((directory) => [directory.id.toLowerCase(), directory]));
  const directoriesByPath = new Map(snapshot.directoryTargets.map((directory) => [directory.path.toLowerCase(), directory]));

  let projected = markdown
    .replace(/<!--.*?-->/gis, "")
    .replace(/<!--.*$/gis, "")
    .replace(/<script(?:\s[^>]*)?>.*?<\/script\s*>/gis, "")
    .replace(/<script(?:\s[^>]*)?>.*$/gis, "")
    .replace(/<style(?:\s[^>]*)?>.*?<\/style\s*>/gis, "")
    .replace(/<style(?:\s[^>]*)?>.*$/gis, "")
    .replace(/<[a-z!?/][^>]*(?:>|$)/gis, "");

  projected = projected.replace(
    new RegExp(`!\\[([^\\]]*)\\]\\(context-use://asset/(${UUID})\\)(\\{[^}\\r\\n]*\\})?`, "gi"),
    (_whole, label: string, id: string, attributes: string | undefined) => {
      const asset = assetsById.get(id.toLowerCase());
      return asset
        ? `![${label}](context-use://public-asset/${asset.public_path})${attributes ?? ""}`
        : label;
    },
  );

  const pageLink = (_whole: string, label: string, id: string, fragment = "") => {
    const page = pagesById.get(id.toLowerCase());
    return page ? `[${label}](/p/${page.public_path}${fragment})` : label;
  };
  projected = projected.replace(
    new RegExp(`\\[([^\\]]*)\\]\\(context-use://page/(${UUID})(#[a-z0-9][a-z0-9_-]*)?\\)`, "gi"),
    pageLink,
  );
  projected = projected.replace(
    new RegExp(`\\[([^\\]]*)\\]\\(/app/pages/(${UUID})(#[a-z0-9][a-z0-9_-]*)?\\)`, "gi"),
    pageLink,
  );

  const directoryLink = (_whole: string, label: string, id: string) => {
    const directory = directoriesById.get(id.toLowerCase());
    if (!directory) return label;
    return directory.path ? `[${label}](/p/${directory.path}/)` : `[${label}](/p/)`;
  };
  projected = projected.replace(
    new RegExp(`\\[([^\\]]*)\\]\\(context-use://directory/(${UUID})\\)`, "gi"),
    directoryLink,
  );
  projected = projected.replace(
    new RegExp(`\\[([^\\]]*)\\]\\(/app/directories/(${UUID})\\)`, "gi"),
    directoryLink,
  );

  projected = projected.replace(
    /\[\[([a-z0-9][a-z0-9/_-]*)(#[a-z0-9][a-z0-9_-]*)?(?:\|([^\]\r\n]+))?\]\]/gi,
    (_whole, rawPath: string, fragment: string | undefined, authoredLabel: string | undefined) => {
      let page: { source_path: string; public_path: string } | undefined;
      let directory: { path: string } | undefined;
      for (const candidate of wikiLinkCandidatePaths(rawPath, sourcePath)) {
        page = pagesBySourcePath.get(candidate);
        if (page) break;
        directory = directoriesByPath.get(candidate);
        if (directory) break;
      }
      const label = replacementLabel(
        authoredLabel ?? "",
        page || directory ? rawPath.replace(/^.*\//, "") : "Private page",
      );
      if (page) return `[${label}](/p/${page.public_path}${fragment ?? ""})`;
      if (directory) return directory.path ? `[${label}](/p/${directory.path}/)` : `[${label}](/p/)`;
      return label;
    },
  );

  return projected
    .replace(new RegExp(`context-use://(?:page|directory|asset)/${UUID}`, "gi"), "[private reference]")
    .replace(new RegExp(`/app/(?:pages|directories)/${UUID}`, "gi"), "[private reference]")
    .replace(new RegExp(`/api/(?:dashboard|mcp|public)/assets/${UUID}(?:/(?:content|status))?`, "gi"), "[private asset reference]")
    .replace(new RegExp(UUID, "gi"), "[private identifier]");
}
