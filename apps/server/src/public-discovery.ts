import type { PublicPage } from "@context-use/database";

/**
 * Optional well-known introduction path. A published page here supplies public
 * profile identity; the public entrypoint itself is configured independently.
 */
export const INTRO_PATH = "about/intro";

/**
 * Optional convention, not a required framework page. When an instance publishes
 * this page, its external links can enrich the structured profile identity.
 */
export const OPTIONAL_CONTACTS_PATH = "about/contacts";

type Introduction = Pick<PublicPage, "title" | "summary"> | null | undefined;

function normalizedOrigin(value: string): string {
  return new URL(value).origin;
}

function normalizedInlineText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
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

/**
 * An explicitly published introduction is the portable source of site identity.
 * A descriptive title wins; otherwise summaries such as "Jane Doe's introduction"
 * provide a useful name without requiring instance-specific configuration.
 */
export function introductionName(introduction: Introduction): string | null {
  if (!introduction) return null;
  const title = normalizedInlineText(introduction.title);
  if (title && !/^(?:about|bio|biography|intro|introduction|profile)$/i.test(title)) return title;
  const summary = normalizedInlineText(introduction.summary);
  const match = /^(.{1,120}?)(?:['’]s)\s+(?:public\s+)?(?:bio(?:graphy)?|introduction|profile)\b/i.exec(summary);
  return match?.[1]?.trim() || null;
}

export function publicSiteName(siteOrigin: string, introduction?: Introduction): string {
  const name = introductionName(introduction);
  return name ? `${name}'s public knowledge` : `${new URL(normalizedOrigin(siteOrigin)).host} public knowledge`;
}

export function externalProfileLinks(markdown: string, siteOrigin: string): string[] {
  const ownOrigin = normalizedOrigin(siteOrigin);
  const links: string[] = [];
  const seen = new Set<string>();
  const markdownLink = /\[[^\]]*\]\((https?:\/\/[^\s)]+)(?:\s+"[^"]*")?\)/gi;
  for (const match of markdown.matchAll(markdownLink)) {
    try {
      const url = new URL(match[1]!);
      if (url.origin === ownOrigin || seen.has(url.href)) continue;
      seen.add(url.href);
      links.push(url.href);
    } catch {
      // Invalid links are ignored at the metadata boundary.
    }
  }
  return links.slice(0, 20);
}

export function renderRobotsTxt(siteOrigin: string): string {
  const origin = normalizedOrigin(siteOrigin);
  return [
    "User-agent: *",
    "Allow: /",
    "Disallow: /api/",
    "Disallow: /app",
    "Disallow: /mcp",
    "",
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n");
}

export function renderSitemapXml(pages: PublicPage[], siteOrigin: string): string {
  const origin = normalizedOrigin(siteOrigin);
  const lastEdited = latestEdit(pages);
  const entries: Array<{ loc: string; lastmod: string | null }> = [
    { loc: `${origin}/`, lastmod: lastEdited },
    { loc: `${origin}/p/`, lastmod: lastEdited },
    ...[...pages]
      .sort((left, right) => left.public_path < right.public_path ? -1 : left.public_path > right.public_path ? 1 : 0)
      .map((page) => ({
        loc: `${origin}/p/${page.public_path}`,
        lastmod: dateIso(page.last_edited_at),
      })),
  ];
  const urls = entries.map(({ loc, lastmod }) => [
    "  <url>",
    `    <loc>${escapeXml(loc)}</loc>`,
    ...(lastmod ? [`    <lastmod>${lastmod}</lastmod>`] : []),
    "  </url>",
  ].join("\n")).join("\n");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urls,
    "</urlset>",
    "",
  ].join("\n");
}
