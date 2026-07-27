import { describe, expect, test } from "bun:test";
import type { PublicPage } from "@context-use/database";
import { renderLlmsFullTxt, renderLlmsTxt, renderPublicPageMarkdown } from "./public-llms.ts";

const options = {
  siteOrigin: "https://massimo.example/ignored-path",
  assetOrigin: "https://assets.massimo.example/ignored-path",
};

const pages: PublicPage[] = [
  {
    public_path: "about/projects/one",
    title: "Project [One]",
    summary: "A project\nwith a concise summary.",
    body_markdown: "Project body.",
    last_edited_at: "2026-07-26T09:00:00.000Z",
  },
  {
    public_path: "about/intro",
    title: "Intro",
    summary: "Massimo's public introduction.",
    body_markdown: [
      "Read [the project](/p/about/projects/one#details) and [the index](/i/about).",
      "",
      "![Public photo](context-use://public-asset/about/photo){size=small}",
      "",
      "[External](https://example.com/story)",
    ].join("\r\n"),
    last_edited_at: new Date("2026-07-27T10:30:00.000Z"),
  },
];

describe("public LLM context", () => {
  test("renders a spec-shaped concise index with the introduction first", () => {
    const content = renderLlmsTxt(pages, options);

    expect(content).toBe([
      "# massimo.example public knowledge",
      "",
      "> Massimo's public introduction.",
      "",
      "Only explicitly published knowledge is included.",
      "",
      "## Complete public context",
      "",
      "- [Full public context](https://massimo.example/llms-full.txt): Complete text of every published page.",
      "",
      "## Public pages",
      "",
      "- [Intro](https://massimo.example/p/about/intro.md): Massimo's public introduction.",
      "- [Project \\[One\\]](https://massimo.example/p/about/projects/one.md): A project with a concise summary.",
      "",
    ].join("\n"));
  });

  test("renders each published page as standalone Markdown", () => {
    const content = renderPublicPageMarkdown(pages[1]!, options);

    expect(content).toStartWith([
      "# Intro",
      "",
      "> Massimo's public introduction.",
      "",
      "- Canonical URL: [https://massimo.example/p/about/intro](https://massimo.example/p/about/intro)",
      "- Site index: [https://massimo.example/llms.txt](https://massimo.example/llms.txt)",
      "- Last edited: 2026-07-27T10:30:00.000Z",
      "",
    ].join("\n"));
    expect(content).toContain("[the project](https://massimo.example/p/about/projects/one#details)");
    expect(content).toContain("![Public photo](https://assets.massimo.example/a/about/photo){size=small}");
    expect(content.endsWith("\n")).toBe(true);
  });

  test("concatenates public Markdown and makes internal links fetchable", () => {
    const content = renderLlmsFullTxt(pages, options);

    expect(content).toContain("- Published pages: 2");
    expect(content).toContain("- Last updated: 2026-07-27T10:30:00.000Z");
    expect(content.indexOf("## Intro")).toBeLessThan(content.indexOf("## Project [One]"));
    expect(content).toContain("[the project](https://massimo.example/p/about/projects/one#details)");
    expect(content).toContain("[the index](https://massimo.example/i/about)");
    expect(content).toContain("![Public photo](https://assets.massimo.example/a/about/photo){size=small}");
    expect(content).toContain("[External](https://example.com/story)");
    expect(content).not.toContain("\r");
    expect(content.endsWith("\n")).toBe(true);
  });

  test("is byte-stable regardless of query result ordering", () => {
    const reversed = [...pages].reverse();

    expect(renderLlmsTxt(reversed, options)).toBe(renderLlmsTxt(pages, options));
    expect(renderLlmsFullTxt(reversed, options)).toBe(renderLlmsFullTxt(pages, options));
  });

  test("redacts private routes and identifiers again at the text boundary", () => {
    const uuid = "11111111-1111-4111-8111-111111111111";
    const privatePage: PublicPage = {
      public_path: "notes/privacy",
      title: "Privacy",
      summary: "Public text with private references removed.",
      body_markdown: [
        `[Page](context-use://page/${uuid})`,
        `/app/directories/${uuid}`,
        `/api/dashboard/assets/${uuid}/content`,
        uuid,
      ].join("\n"),
      last_edited_at: "2026-07-20T00:00:00.000Z",
    };

    const content = renderLlmsFullTxt([privatePage], options);

    expect(content).not.toContain(uuid);
    expect(content).not.toContain("context-use://page/");
    expect(content).not.toContain("/app/directories/");
    expect(content).not.toContain("/api/dashboard/assets/");
    expect(content).toContain("[private reference]");
    expect(content).toContain("[private asset reference]");
    expect(content).toContain("[private identifier]");
  });
});
