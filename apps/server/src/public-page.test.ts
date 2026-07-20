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
    expect(html).toContain("Hosted with");
    expect(html).toContain("Self-hostable · private by default");
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

  test("renders the first-person billboard with the configured MCP endpoint", () => {
    const endpoint = "https://agents.example.net/custom-mcp?label=a&b=\"quoted\"";
    const html = renderPublicLandingDocument(endpoint);

    expect(html).toContain("A public billboard<br>for people and agents");
    expect(html).toContain("what I choose to share");
    expect(html).toContain('href="/p/about/intro"');
    expect(html).toContain("Explore my knowledge base");
    expect(html).not.toContain("send_message");
    expect(html).not.toContain("private inbox");
    expect(html).toContain("https://agents.example.net/custom-mcp?label=a&amp;b=&quot;quoted&quot;");
  });

  test("styles the footnote, billboard, and long MCP URLs", () => {
    expect(publicPageStyles).toContain(".context-use-footnote{");
    expect(publicPageStyles).toContain(".public-landing{");
    expect(publicPageStyles).toContain("img,video{max-width:100%");
    expect(publicPageStyles).toContain("video,audio{width:100%}");
    expect(publicPageStyles).toContain("overflow-wrap:anywhere");
    expect(IMAGE_LAYOUT_STYLES).toContain(".cu-image--layout-half{");
    expect(IMAGE_LAYOUT_STYLES).toContain("object-fit:cover");
    expect(IMAGE_LAYOUT_STYLES).toContain("@media(max-width:640px)");
  });
});
