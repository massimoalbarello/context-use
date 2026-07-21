import { describe, expect, test } from "bun:test";
import {
  IMAGE_LAYOUT_STYLES,
  publicPageStyles,
  renderPublicIndexDocument,
  renderPublicLandingDocument,
  renderPublicPageDocument,
} from "./public-page.ts";

describe("public page presentation", () => {
  test("adds only the compact context-use footnote to knowledge pages", () => {
    const html = renderPublicPageDocument("Public notes", "<h1>Hello</h1>");

    expect(html).toContain("<article><h1>Hello</h1></article><footer class=\"context-use-footnote\">");
    expect(html).toContain('<p>self-hosted with ❤️ using <a href="https://github.com/massimoalbarello/context-use">context-use</a>.</p>');
    expect(html).not.toContain("private by default");
    expect(html).not.toContain("MCP");
  });

  test("escapes document metadata while preserving sanitized page content", () => {
    const html = renderPublicPageDocument(
      "Notes </title><script>alert(1)</script>",
      "<p>Already sanitized content</p>",
    );

    expect(html).toContain("<title>Notes &lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;</title>");
    expect(html).toContain("<p>Already sanitized content</p>");
    expect(html).toContain('<link rel="stylesheet" href="/content.css">');
  });

  test("adds framework-owned root and parent index links to published pages", () => {
    const nested = renderPublicPageDocument("Como", "<p>Story</p>", "about/chapters/como");
    const rootPage = renderPublicPageDocument("Notes", "<p>Text</p>", "notes");

    expect(nested).toContain('<nav class="knowledge-navigation" aria-label="Knowledge navigation"><a href="/i">Knowledge index</a>');
    expect(nested).toContain('<a href="/i/about/chapters">Chapters index</a>');
    expect(rootPage.match(/href="\/i"/g)).toHaveLength(1);
  });

  test("renders generated public indexes from published pages and branches", () => {
    const html = renderPublicIndexDocument({
      path: "about/chapters",
      entries: [
        { kind: "directory", path: "about/chapters/early-years", title: null, summary: null, published_count: 2 },
        { kind: "page", path: "about/chapters/como", title: "Como", summary: "Growing up at the foot of the Alps.", published_count: 1 },
      ],
    });

    expect(html).toContain('<a href="/i">Knowledge index</a>');
    expect(html).toContain('<a href="/i/about">About index</a>');
    expect(html).toContain('<a href="/i/about/chapters/early-years">Early Years</a><span>— 2 published pages.</span>');
    expect(html).toContain('<a href="/p/about/chapters/como">Como</a><span>— Growing up at the foot of the Alps.</span>');
    expect(html).toContain("Only explicitly published knowledge appears here.");
  });

  test("renders the first-person billboard and optional introduction link", () => {
    const html = renderPublicLandingDocument();

    expect(html).toContain("A public billboard<br>for what I choose to share");
    expect(html).toContain("what I choose to share");
    expect(html).toContain('href="/p/about/intro"');
    expect(html).toContain("Explore my knowledge base");
    expect(html).not.toContain("MCP");
  });

  test("styles the footnote, billboard, and published media", () => {
    expect(publicPageStyles).toContain(".context-use-footnote{");
    expect(publicPageStyles).toContain(".knowledge-navigation{");
    expect(publicPageStyles).toContain(".public-index-list{");
    expect(publicPageStyles).toContain(".public-landing{");
    expect(publicPageStyles).toContain("img,video{max-width:100%");
    expect(publicPageStyles).toContain("video,audio{width:100%}");
    expect(publicPageStyles).toContain("display:flex");
    expect(IMAGE_LAYOUT_STYLES).toContain(".cu-image--layout-half{");
    expect(IMAGE_LAYOUT_STYLES).toContain("object-fit:cover");
    expect(IMAGE_LAYOUT_STYLES).toContain("@media(max-width:640px)");
  });
});
