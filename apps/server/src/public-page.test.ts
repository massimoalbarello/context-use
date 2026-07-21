import { describe, expect, test } from "bun:test";
import {
  IMAGE_LAYOUT_STYLES,
  publicPageStyles,
  renderPublicLandingDocument,
  renderPublicPageDocument,
} from "./public-page.ts";

describe("public page presentation", () => {
  test("adds only the compact context-use footnote to knowledge pages", () => {
    const html = renderPublicPageDocument("Public notes", "<h1>Hello</h1>");

    expect(html).toContain("<article><h1>Hello</h1></article><footer class=\"context-use-footnote\">");
    expect(html).toContain('<p>self-hosted with love using <a href="https://github.com/massimoalbarello/context-use">context-use</a>.</p>');
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
    expect(publicPageStyles).toContain(".public-landing{");
    expect(publicPageStyles).toContain("img,video{max-width:100%");
    expect(publicPageStyles).toContain("video,audio{width:100%}");
    expect(publicPageStyles).toContain("display:flex");
    expect(IMAGE_LAYOUT_STYLES).toContain(".cu-image--layout-half{");
    expect(IMAGE_LAYOUT_STYLES).toContain("object-fit:cover");
    expect(IMAGE_LAYOUT_STYLES).toContain("@media(max-width:640px)");
  });
});
