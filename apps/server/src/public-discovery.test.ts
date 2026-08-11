import { describe, expect, test } from "bun:test";
import type { PublicPage } from "@context-use/database";
import {
  introductionName,
  externalProfileLinks,
  publicSiteName,
  renderRobotsTxt,
  renderSitemapXml,
} from "./public-discovery.ts";

const pages: PublicPage[] = [
  {
    public_path: "projects/one&only",
    title: "One & only",
    summary: "The first project.",
    body_markdown: "Project body.",
    last_edited_at: "2026-07-26T09:00:00.000Z",
  },
  {
    public_path: "about/intro",
    title: "Intro",
    summary: "Massimo Albarello's introduction: a builder from Como.",
    body_markdown: "Biography.",
    last_edited_at: new Date("2026-07-27T10:30:00.000Z"),
  },
];

describe("public crawler discovery", () => {
  test("derives portable identity from a published introduction", () => {
    expect(introductionName(pages[1])).toBe("Massimo Albarello");
    expect(introductionName({ title: "Ada Lovelace", summary: "A computing pioneer." })).toBe("Ada Lovelace");
    expect(introductionName({ title: "Biography", summary: "A public introduction." })).toBeNull();
    expect(publicSiteName("https://massimo.example/path", pages[1])).toBe("Massimo Albarello's public knowledge");
    expect(publicSiteName("https://massimo.example/path")).toBe("massimo.example public knowledge");
  });

  test("allows public crawling while keeping application surfaces out", () => {
    expect(renderRobotsTxt("https://massimo.example/ignored")).toBe([
      "User-agent: *",
      "Allow: /",
      "Disallow: /api/",
      "Disallow: /app",
      "Disallow: /mcp",
      "",
      "Sitemap: https://massimo.example/sitemap.xml",
      "",
    ].join("\n"));
  });

  test("extracts explicitly published external identity links", () => {
    expect(externalProfileLinks([
      "- [GitHub](https://github.com/massimoalbarello)",
      "- [LinkedIn](https://www.linkedin.com/in/massimoalbarello/)",
      "- [Knowledge](https://massimo.example/p/)",
      "- [GitHub again](https://github.com/massimoalbarello)",
      "- [Email](mailto:hello@example.com)",
    ].join("\n"), "https://massimo.example")).toEqual([
      "https://github.com/massimoalbarello",
      "https://www.linkedin.com/in/massimoalbarello/",
    ]);
  });

  test("lists every canonical HTML page with stable modification dates", () => {
    const sitemap = renderSitemapXml(pages, "https://massimo.example/ignored");

    expect(sitemap).toStartWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(sitemap).toContain("<loc>https://massimo.example/</loc>\n    <lastmod>2026-07-27T10:30:00.000Z</lastmod>");
    expect(sitemap).toContain("<loc>https://massimo.example/p/</loc>");
    expect(sitemap).toContain("<loc>https://massimo.example/p/about/intro</loc>");
    expect(sitemap).toContain("<loc>https://massimo.example/p/projects/one&amp;only</loc>");
    expect(sitemap).not.toContain(".md</loc>");
    expect(sitemap.endsWith("\n")).toBe(true);
  });
});
