import type { PublicPage } from "@context-use/database";
import { INTRO_PATH, publicSiteName } from "./public-discovery.ts";

const PRIVATE_UUID = "[private identifier]";

type PublicLlmsOptions = {
  siteOrigin: string;
  assetOrigin: string;
};

function normalizedOrigin(value: string): string {
  return new URL(value).origin;
}

function normalizedInlineText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function escapedLinkLabel(value: string): string {
  return normalizedInlineText(value)
    .replaceAll("\\", "\\\\")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]");
}

function normalizedMarkdown(value: string): string {
  return value.replace(/\r\n?/g, "\n").trim();
}

function publicPageUrl(origin: string, path: string): string {
  return `${origin}/p/${path}`;
}

function publicMarkdownPageUrl(origin: string, path: string): string {
  return `${publicPageUrl(origin, path)}.md`;
}

function introFirst(left: PublicPage, right: PublicPage): number {
  if (left.public_path === INTRO_PATH && right.public_path !== INTRO_PATH) return -1;
  if (right.public_path === INTRO_PATH && left.public_path !== INTRO_PATH) return 1;
  return left.public_path < right.public_path ? -1 : left.public_path > right.public_path ? 1 : 0;
}

function orderedPages(pages: PublicPage[]): PublicPage[] {
  return [...pages].sort(introFirst);
}

function descriptionFor(pages: PublicPage[]): string {
  const introduction = pages.find(({ public_path }) => public_path === INTRO_PATH);
  return normalizedInlineText(introduction?.summary ?? "")
    || "Only explicitly published knowledge is included.";
}

function dateIso(value: string | Date): string | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function latestEdit(pages: PublicPage[]): string | null {
  return pages.reduce<string | null>((latest, page) => {
    const edited = dateIso(page.last_edited_at);
    return edited !== null && (latest === null || edited > latest) ? edited : latest;
  }, null);
}

function redactPrivateReferences(markdown: string): string {
  return markdown
    .replace(
      /context-use:\/\/(?:page|directory|asset)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      "[private reference]",
    )
    .replace(
      /\/app\/(?:pages|directories)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      "[private reference]",
    )
    .replace(
      /\/api\/(?:dashboard|mcp|public)\/assets\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\/(?:content|status))?/gi,
      "[private asset reference]",
    )
    .replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      PRIVATE_UUID,
    );
}

function absolutePublicMarkdown(
  markdown: string,
  siteOrigin: string,
  assetOrigin: string,
): string {
  let result = normalizedMarkdown(markdown).replace(
    /context-use:\/\/public-asset\/([a-z0-9][a-z0-9/_-]*)/gi,
    (_match, path: string) => `${assetOrigin}/a/${path.toLowerCase()}`,
  );
  result = result.replace(
    /(\]\()\/((?:p|i)(?:\/[a-z0-9][a-z0-9/_-]*)?(?:#[a-z0-9][a-z0-9_-]*)?)(\))/gi,
    (_match, prefix: string, path: string, suffix: string) => `${prefix}${siteOrigin}/${path}${suffix}`,
  );
  return redactPrivateReferences(result);
}

export function renderLlmsTxt(pages: PublicPage[], options: PublicLlmsOptions): string {
  const siteOrigin = normalizedOrigin(options.siteOrigin);
  const ordered = orderedPages(pages);
  const introduction = ordered.find(({ public_path }) => public_path === INTRO_PATH);
  const lines = [
    `# ${publicSiteName(siteOrigin, introduction)}`,
    "",
    `> ${descriptionFor(ordered)}`,
    "",
    "Only explicitly published knowledge is included.",
    "",
    "## Discovery",
    "",
    `- [Human-readable knowledge index](${siteOrigin}/p/): Browse every published branch.`,
    `- [XML sitemap](${siteOrigin}/sitemap.xml): Canonical HTML URLs for every published page.`,
    "",
    "## Complete public context",
    "",
    `- [Full public context](${siteOrigin}/llms-full.txt): Complete text of every published page.`,
  ];
  if (ordered.length) {
    lines.push("", "## Public pages", "");
    for (const page of ordered) {
      lines.push(
        `- [${escapedLinkLabel(page.title)}](${publicMarkdownPageUrl(siteOrigin, page.public_path)}): ${normalizedInlineText(page.summary)}`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

export function renderPublicPageMarkdown(page: PublicPage, options: PublicLlmsOptions): string {
  const siteOrigin = normalizedOrigin(options.siteOrigin);
  const assetOrigin = normalizedOrigin(options.assetOrigin);
  const canonicalUrl = publicPageUrl(siteOrigin, page.public_path);
  const lines = [
    `# ${normalizedInlineText(page.title)}`,
    "",
    `> ${normalizedInlineText(page.summary)}`,
    "",
    `- Canonical URL: [${canonicalUrl}](${canonicalUrl})`,
    `- Site index: [${siteOrigin}/llms.txt](${siteOrigin}/llms.txt)`,
    `- Knowledge index: [${siteOrigin}/p/](${siteOrigin}/p/)`,
  ];
  const edited = dateIso(page.last_edited_at);
  if (edited !== null) lines.push(`- Last edited: ${edited}`);
  const body = absolutePublicMarkdown(page.body_markdown, siteOrigin, assetOrigin);
  if (body) lines.push("", body);
  return `${lines.join("\n")}\n`;
}

export function renderLlmsFullTxt(pages: PublicPage[], options: PublicLlmsOptions): string {
  const siteOrigin = normalizedOrigin(options.siteOrigin);
  const assetOrigin = normalizedOrigin(options.assetOrigin);
  const ordered = orderedPages(pages);
  const introduction = ordered.find(({ public_path }) => public_path === INTRO_PATH);
  const lines = [
    `# ${publicSiteName(siteOrigin, introduction)} — full public context`,
    "",
    `> ${descriptionFor(ordered)}`,
    "",
    "This document contains every explicitly published page.",
    "",
    `- Concise index: [${siteOrigin}/llms.txt](${siteOrigin}/llms.txt)`,
    `- Human-readable knowledge index: [${siteOrigin}/p/](${siteOrigin}/p/)`,
    `- Published pages: ${ordered.length}`,
  ];
  const lastEdited = latestEdit(ordered);
  if (lastEdited !== null) lines.push(`- Last updated: ${lastEdited}`);

  for (const page of ordered) {
    const canonicalUrl = publicPageUrl(siteOrigin, page.public_path);
    lines.push(
      "",
      "---",
      "",
      `## ${normalizedInlineText(page.title)}`,
      "",
      `- Canonical URL: [${canonicalUrl}](${canonicalUrl})`,
      `- Public path: \`${page.public_path}\``,
      `- Summary: ${normalizedInlineText(page.summary)}`,
    );
    const edited = dateIso(page.last_edited_at);
    if (edited !== null) lines.push(`- Last edited: ${edited}`);
    const body = absolutePublicMarkdown(page.body_markdown, siteOrigin, assetOrigin);
    if (body) lines.push("", body);
  }

  return `${lines.join("\n")}\n`;
}
