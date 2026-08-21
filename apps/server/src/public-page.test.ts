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
    expect(html).toContain('<a href="/llms.txt" type="text/plain">AI-readable site index</a>');
    expect(html).toContain('<p class="context-use-credit">self-hosted with ❤️ using <a class="external-link" href="https://github.com/massimoalbarello/context-use" target="_blank" rel="noopener noreferrer" title="External link (opens in a new tab)">context-use</a>.</p>');
    expect(html).not.toContain("private by default");
    expect(html).not.toContain("MCP");
  });

  test("escapes document metadata while preserving sanitized page content", () => {
    const html = renderPublicPageDocument(
      "Notes </title><script>alert(1)</script>",
      "<p>Already sanitized content</p>",
      "notes",
    );

    expect(html).toContain("<title>Notes &lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt; | localhost:3000 public knowledge</title>");
    expect(html).toContain('<li aria-current="page"><span class="breadcrumb-separator" aria-hidden="true">/</span>Notes &lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;</li>');
    expect(html).toContain('name="description" content="Published knowledge from localhost:3000 public knowledge."');
    expect(html).toContain('rel="canonical" href="http://localhost:3000/p/notes"');
    expect(html).toContain('<script type="application/ld+json">');
    expect(html).toContain('"@type":"WebPage"');
    expect(html).not.toContain('"name":"Notes </title>');
    expect(html).toContain("<p>Already sanitized content</p>");
    expect(html).toContain('<link rel="stylesheet" href="/content.css">');
  });

  test("keeps the page title and summary out of the published body", () => {
    const html = renderPublicPageDocument(
      "Intro",
      "<p>Biography body.</p>",
      "about/intro",
      undefined,
      {
        siteOrigin: "https://massimo.example",
        summary: "Massimo Albarello's introduction: a builder from Como.",
        introduction: { title: "Intro", summary: "Massimo Albarello's introduction: a builder from Como." },
      },
    );

    expect(html).toContain('<nav class="knowledge-navigation"');
    expect(html).toContain("</nav><article><p>Biography body.</p></article>");
    expect(html).not.toContain("public-page-header");
    expect(html).not.toContain("<h1>");
    expect(html).toContain('name="description" content="Massimo Albarello&#39;s introduction: a builder from Como."');
  });

  test("adds a complete folder breadcrumb to published pages", () => {
    const nested = renderPublicPageDocument("Como", "<p>Story</p>", "about/chapters/como");
    const rootPage = renderPublicPageDocument("Notes", "<p>Text</p>", "notes");

    expect(nested).toContain('<nav class="knowledge-navigation" aria-label="Breadcrumb"><ol><li><a href="/">Home</a></li>');
    expect(nested).toContain('<li><span class="breadcrumb-separator" aria-hidden="true">/</span><a href="/p/">Knowledge</a></li>');
    expect(nested).toContain('<li><span class="breadcrumb-separator" aria-hidden="true">/</span><a href="/p/about/">About</a></li>');
    expect(nested).toContain('<li><span class="breadcrumb-separator" aria-hidden="true">/</span><a href="/p/about/chapters/">Chapters</a></li>');
    expect(nested).toContain('<li aria-current="page"><span class="breadcrumb-separator" aria-hidden="true">/</span>Como</li></ol></nav>');
    expect(nested).toContain('<link rel="alternate" type="text/markdown" href="/p/about/chapters/como.md" title="Como as Markdown">');
    expect(nested).toContain('<a href="/p/about/chapters/como.md" type="text/markdown">View as Markdown</a>');
    expect(rootPage.match(/href="\/"/g)).toHaveLength(1);
    expect(rootPage.match(/href="\/p\/"/g)).toHaveLength(1);
    expect(rootPage).toContain('<li aria-current="page"><span class="breadcrumb-separator" aria-hidden="true">/</span>Notes</li>');
    expect(rootPage.match(/href="\/p\/notes\.md"/g)).toHaveLength(2);
  });

  test("shows the published version edit date after the page content", () => {
    const html = renderPublicPageDocument(
      "Public notes",
      "<h1>Hello</h1>",
      "notes",
      "2026-07-21T13:45:00.000Z",
    );

    expect(html).toContain('<article><h1>Hello</h1></article><footer class="context-use-footnote"><p class="context-use-credit">');
    expect(html).toContain('<span class="page-last-edited"><strong>Last edited</strong> <time datetime="2026-07-21T13:45:00.000Z">21 July 2026</time></span>');
    expect(html).toContain('<span class="footer-separator" aria-hidden="true">·</span><a href="/p/notes.md" type="text/markdown">View as Markdown</a>');
  });

  test("identifies a published introduction as a canonical biography", () => {
    const introduction = {
      title: "Intro",
      summary: "Massimo Albarello's introduction: a builder from Como.",
    };
    const html = renderPublicPageDocument(
      introduction.title,
      "<p>Biography body.</p>",
      "about/intro",
      "2026-08-07T11:25:59.777Z",
      {
        siteOrigin: "https://massimo.example",
        summary: introduction.summary,
        introduction,
        profileLinks: ["https://github.com/massimoalbarello"],
      },
    );

    expect(html).toContain("<title>Massimo Albarello — Biography</title>");
    expect(html).toContain('rel="canonical" href="https://massimo.example/p/about/intro"');
    expect(html).toContain('property="og:type" content="profile"');
    expect(html).toContain('"@type":"ProfilePage"');
    expect(html).toContain('"mainEntity":{"@id":"https://massimo.example/p/about/intro#person"}');
    expect(html).toContain('"@type":"Person"');
    expect(html).toContain('"sameAs":["https://github.com/massimoalbarello"]');
    expect(html).toContain('"dateModified":"2026-08-07T11:25:59.777Z"');
  });

  test("renders generated public indexes from published pages and branches", () => {
    const html = renderPublicIndexDocument({
      path: "about/chapters",
      title: "Life chapters",
      default_page_path: null,
      entries: [
        { kind: "directory", path: "about/chapters/early-years", title: "The early years", summary: "Childhood stories and formative experiences.", published_count: 2, default_page_path: null },
        { kind: "directory", path: "about/chapters/only-child", title: "Only child", summary: "Growing up as an only child.", published_count: 1, default_page_path: "about/chapters/only-child/story" },
        { kind: "directory", path: "about/chapters/undocumented", title: "Undocumented", summary: "", published_count: 1, default_page_path: null },
        { kind: "page", path: "about/chapters/como", title: "Como", summary: "Growing up at the foot of the Alps.", published_count: 1, default_page_path: null },
      ],
    });
    const rootHtml = renderPublicIndexDocument({
      path: "",
      title: "Knowledge",
      default_page_path: null,
      entries: [],
    });

    expect(html).toContain('<nav class="knowledge-navigation" aria-label="Breadcrumb"><ol><li><a href="/">Home</a></li>');
    expect(html).toContain('<li><span class="breadcrumb-separator" aria-hidden="true">/</span><a href="/p/">Knowledge</a></li>');
    expect(html).toContain('<li><span class="breadcrumb-separator" aria-hidden="true">/</span><a href="/p/about/">About</a></li>');
    expect(html).toContain('<li aria-current="page"><span class="breadcrumb-separator" aria-hidden="true">/</span>Life chapters</li>');
    expect(html).toContain('<header class="public-index-header"><h1>Life chapters</h1></header>');
    expect(html).toContain('<a href="/p/about/chapters/early-years/">The early years</a><span>— Childhood stories and formative experiences.</span>');
    expect(html).toContain('<a href="/p/about/chapters/only-child/story">Only child</a><span>— Growing up as an only child.</span>');
    expect(html).toContain('<a href="/p/about/chapters/undocumented/">Undocumented</a><span>— Published folder.</span>');
    expect(html).toContain('<a href="/p/about/chapters/como">Como</a><span>— Growing up at the foot of the Alps.</span>');
    expect(html).not.toContain("published page");
    expect(html).not.toContain("Only explicitly published knowledge appears here.");
    expect(html).toContain('<a href="/llms.txt" type="text/plain">AI-readable site index</a>');
    expect(html).not.toContain("Generated index");
    expect(html).not.toContain("Chapters index");
    expect(rootHtml).toContain("<title>Knowledge | localhost:3000 public knowledge</title>");
    expect(rootHtml).toContain('rel="canonical" href="http://localhost:3000/p/"');
    expect(rootHtml).toContain('"@type":"CollectionPage"');
    expect(rootHtml).toContain('<nav class="knowledge-navigation" aria-label="Breadcrumb"><ol><li><a href="/">Home</a></li><li aria-current="page"><span class="breadcrumb-separator" aria-hidden="true">/</span>Knowledge</li>');
    expect(rootHtml).toContain('<header class="public-index-header"><h1>Knowledge</h1></header>');
    expect(rootHtml).not.toContain("<p>Contents</p>");
    expect(rootHtml).not.toContain("Knowledge index");
  });

  test("renders the first-person billboard and optional introduction link", () => {
    const html = renderPublicLandingDocument({
      siteOrigin: "https://massimo.example",
      introduction: {
        title: "Intro",
        summary: "Massimo Albarello's introduction: a builder from Como.",
      },
      entrypointPublicPath: "about/intro",
      profileLinks: ["https://github.com/massimoalbarello"],
    });

    expect(html).toContain("<title>Massimo Albarello&#39;s public knowledge</title>");
    expect(html).toContain("Massimo Albarello’s public context.");
    expect(html).toContain("Massimo Albarello&#39;s introduction: a builder from Como.");
    expect(html).toContain('href="/p/about/intro"');
    expect(html).toContain("Read my biography");
    expect(html).not.toContain("Browse all published knowledge");
    expect(html).toContain('rel="canonical" href="https://massimo.example/"');
    expect(html).toContain('"@type":"Person"');
    expect(html).toContain('"name":"Massimo Albarello"');
    expect(html).toContain('"sameAs":["https://github.com/massimoalbarello"]');
    expect(html).toContain('<a href="/llms.txt" type="text/plain">AI-readable site index</a>');
    expect(html).toContain('<p class="landing-credit">self-hosted with ❤️ using');
    expect(html).not.toContain("MCP");
  });

  test("sends visitors to the public index when no entry point is configured", () => {
    const html = renderPublicLandingDocument({ siteOrigin: "https://someone.example" });

    expect(html).toContain('<a class="landing-cta" href="/p/">Explore my knowledge base');
    expect(html).toContain("A public billboard<br>for what I choose to share.");
    expect(html).toContain("<title>someone.example public knowledge</title>");
    expect(html).not.toContain('"@type":"Person"');
  });

  test("does not require an optional contacts page for profile identity", () => {
    const html = renderPublicLandingDocument({
      siteOrigin: "https://massimo.example",
      introduction: {
        title: "Intro",
        summary: "Massimo Albarello's introduction: a builder from Como.",
      },
    });

    expect(html).toContain('"@type":"Person"');
    expect(html).toContain('"name":"Massimo Albarello"');
    expect(html).not.toContain('"sameAs"');
  });

  test("binds structured profile identity to the configured entry point", () => {
    const html = renderPublicLandingDocument({
      siteOrigin: "https://massimo.example",
      introduction: {
        title: "Massimo Albarello",
        summary: "Massimo Albarello's public profile.",
      },
      entrypointPublicPath: "start-here",
    });

    expect(html).toContain('"@id":"https://massimo.example/p/start-here#person"');
    expect(html).toContain('"url":"https://massimo.example/p/start-here"');
    expect(html).not.toContain("/p/about/intro#person");
  });

  test("styles the footnote, billboard, and published media", () => {
    expect(publicPageStyles).toContain(".context-use-footnote{");
    expect(publicPageStyles).toContain(".context-use-credit{");
    expect(publicPageStyles).toContain(".context-use-utilities{");
    expect(publicPageStyles).toContain(".knowledge-navigation{");
    expect(publicPageStyles).toContain(".public-index-list{");
    expect(publicPageStyles).toContain(".public-landing{");
    expect(publicPageStyles).toContain(":is(h1,h2,h3,h4,h5,h6)[id]{scroll-margin-top:1.5rem}");
    expect(publicPageStyles).toContain('.external-link::after{');
    expect(publicPageStyles).toContain('content:"↗"');
    expect(publicPageStyles).toContain("img,video{max-width:100%");
    expect(publicPageStyles).toContain("video,audio{width:100%}");
    expect(publicPageStyles).toContain("display:flex");
    expect(IMAGE_LAYOUT_STYLES).toContain(".cu-image--layout-half{");
    expect(IMAGE_LAYOUT_STYLES).toContain(".cu-image>img,.cu-image>video{");
    expect(IMAGE_LAYOUT_STYLES).toContain(".cu-image--shape-square>video");
    expect(IMAGE_LAYOUT_STYLES).toContain("object-fit:cover");
    expect(IMAGE_LAYOUT_STYLES).toContain("@media(max-width:640px)");
  });
});
