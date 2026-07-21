import { describe, expect, test } from "bun:test";
import { config } from "./config.ts";
import { publicationWarnings, renderMarkdown } from "./markdown.ts";

const privateResolvers = {
  page: async () => ({ available: false as const }),
  directory: async () => ({ available: false as const }),
  pagePath: async () => ({ available: false as const }),
  asset: async () => ({ available: false as const }),
};

describe("safe Markdown rendering", () => {
  test("scans public titles and summaries as well as the Markdown body", () => {
    expect(publicationWarnings("Safe body", ["Safe title", "secret = summary-canary"]))
      .toContain("Possible secret material detected; review the page carefully");
    expect(publicationWarnings("Safe body", ["https://example.com", "Safe summary"]))
      .toContain("1 external URL(s) will become public");
  });

  test("removes scripts, event handlers, unsafe URLs, and remote inline media", async () => {
    const html = await renderMarkdown(
      `<script>alert(1)</script>\n<a href="javascript:alert(1)" onclick="alert(1)">bad</a>\n![remote](https://attacker.example/pixel.png)\n<video src="https://attacker.example/video.mp4" autoplay></video>`,
      privateResolvers,
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<video");
    expect(html).not.toContain("attacker.example");
  });

  test("embeds safe images and videos while rendering PDFs as new-tab links", async () => {
    const imageId = "11111111-1111-4111-8111-111111111111";
    const videoId = "22222222-2222-4222-8222-222222222222";
    const pdfId = "33333333-3333-4333-8333-333333333333";
    const resolutions = new Map([
      [imageId, { available: true as const, href: `/api/dashboard/assets/${imageId}/content`, contentType: "image/png" }],
      [videoId, { available: true as const, href: `/api/dashboard/assets/${videoId}/content`, contentType: "video/mp4" }],
      [pdfId, { available: true as const, href: `/api/dashboard/assets/${pdfId}/content`, contentType: "application/pdf" }],
    ]);
    const html = await renderMarkdown(
      `![A photo](context-use://asset/${imageId})\n\n![A demo](context-use://asset/${videoId})\n\n![](context-use://asset/${pdfId})`,
      {
        ...privateResolvers,
        asset: async (id) => resolutions.get(id) ?? { available: false as const },
      },
    );

    expect(html).toContain(`<img src="/api/dashboard/assets/${imageId}/content" alt="A photo" loading="lazy"`);
    expect(html).toContain(`<video src="/api/dashboard/assets/${videoId}/content" controls preload="metadata" aria-label="A demo">`);
    expect(html).toContain(`<a href="/api/dashboard/assets/${pdfId}/content" target="_blank" rel="noopener noreferrer">Open PDF</a>`);
    expect(html).not.toContain(`<img src="/api/dashboard/assets/${videoId}/content"`);
    expect(html).not.toContain(`<img src="/api/dashboard/assets/${pdfId}/content"`);
  });

  test("renders only the supported image formatting attributes as safe classes", async () => {
    const imageId = "11111111-1111-4111-8111-111111111111";
    const html = await renderMarkdown(
      `![A <portrait>](context-use://asset/${imageId}){size=small align=right shape=square layout=half}`,
      {
        ...privateResolvers,
        asset: async () => ({
          available: true as const,
          href: `/api/dashboard/assets/${imageId}/content`,
          contentType: "image/jpeg",
        }),
      },
    );

    expect(html).toContain('<span class="cu-image cu-image--size-small cu-image--align-right cu-image--shape-square cu-image--layout-half">');
    expect(html).toContain(`src="/api/dashboard/assets/${imageId}/content" alt="A &lt;portrait&gt;" loading="lazy"`);
    expect(html).not.toContain("context-use://");
  });

  test("keeps canonical published-asset paths for plain and formatted public images", async () => {
    const imageId = "11111111-1111-4111-8111-111111111111";
    const publicHref = `${config.ASSET_ORIGIN}/a/photos/portrait`;
    const resolver = {
      ...privateResolvers,
      asset: async () => ({ available: true as const, href: publicHref, contentType: "image/avif" }),
    };
    const plain = await renderMarkdown(`![Plain](context-use://asset/${imageId})`, resolver);
    const formatted = await renderMarkdown(
      `![Formatted](context-use://asset/${imageId}){size=large align=center}`,
      resolver,
    );

    expect(plain).toContain(`<img src="${publicHref}" alt="Plain" loading="lazy"`);
    expect(formatted).toContain(`<img src="${publicHref}" alt="Formatted" loading="lazy">`);
  });

  test("renders the UUID-free published-asset projection without private lookup capability", async () => {
    const publicHref = `${config.ASSET_ORIGIN}/a/media/published-photo`;
    const html = await renderMarkdown(
      "![Projected](context-use://public-asset/media/published-photo){shape=square}",
      {
        ...privateResolvers,
        publicAssetPath: async (path) => path === "media/published-photo"
          ? { available: true as const, href: publicHref, contentType: "image/webp" }
          : { available: false as const },
      },
    );

    expect(html).toContain(`<img src="${publicHref}" alt="Projected" loading="lazy">`);
    expect(html).not.toContain("context-use://");
    expect(html).not.toMatch(/[0-9a-f]{8}-[0-9a-f-]{27}/i);
  });

  test("uses predictable defaults and leaves invalid formatting visible for review", async () => {
    const imageId = "11111111-1111-4111-8111-111111111111";
    const resolver = {
      ...privateResolvers,
      asset: async () => ({
        available: true as const,
        href: `/api/dashboard/assets/${imageId}/content`,
        contentType: "image/png",
      }),
    };
    const valid = await renderMarkdown(
      `![Centered](context-use://asset/${imageId}){shape=landscape}`,
      resolver,
    );
    const invalid = await renderMarkdown(
      `![Typo](context-use://asset/${imageId}){algin=center style=display:none}`,
      resolver,
    );

    expect(valid).toContain("cu-image--size-medium cu-image--align-center cu-image--shape-landscape cu-image--layout-block");
    expect(invalid).toContain("{algin=center style=display:none}");
    expect(invalid).not.toContain("cu-image");
    expect(invalid).not.toContain('display:none"');
  });

  test("keeps consecutive half-width images as sibling elements for responsive columns", async () => {
    const firstId = "11111111-1111-4111-8111-111111111111";
    const secondId = "22222222-2222-4222-8222-222222222222";
    const html = await renderMarkdown(
      `![First](context-use://asset/${firstId}){layout=half shape=square}\n![Second](context-use://asset/${secondId}){layout=half shape=square}`,
      {
        ...privateResolvers,
        asset: async (id) => ({
          available: true as const,
          href: `/api/dashboard/assets/${id}/content`,
          contentType: "image/webp",
        }),
      },
    );

    expect(html.match(/<span class="[^"]*cu-image--layout-half[^"]*">/g)).toHaveLength(2);
    expect(html).toContain("<p><span");
  });

  test("does not allow authored HTML to opt into arbitrary layout classes", async () => {
    const imageId = "11111111-1111-4111-8111-111111111111";
    const html = await renderMarkdown(
      `<span class="cu-image cu-image--shape-square attacker"><img src="/api/dashboard/assets/${imageId}/content"></span>`,
      privateResolvers,
    );

    expect(html).not.toContain("attacker");
    expect(html).not.toContain("cu-image");
    expect(html).toContain("<img");
  });

  test("keeps hand-written media only for canonical asset URLs", async () => {
    const videoId = "22222222-2222-4222-8222-222222222222";
    const audioId = "33333333-3333-4333-8333-333333333333";
    const html = await renderMarkdown(
      `<video src="/api/dashboard/assets/${videoId}/content" autoplay></video>\n<audio><source src="/api/dashboard/assets/${audioId}/content" type="audio/mpeg"></audio>`,
      privateResolvers,
    );

    expect(html).toContain(`<video src="/api/dashboard/assets/${videoId}/content" controls preload="metadata"></video>`);
    expect(html).toContain(`<audio controls preload="metadata"><source src="/api/dashboard/assets/${audioId}/content" type="audio/mpeg"></source></audio>`);
    expect(html).not.toContain("autoplay");
  });

  test("does not resolve metadata for private stable references", async () => {
    const html = await renderMarkdown(
      `[My private label](context-use://page/11111111-1111-4111-8111-111111111111)\n\n![photo](context-use://asset/22222222-2222-4222-8222-222222222222)`,
      privateResolvers,
    );
    expect(html).toContain("My private label");
    expect(html).toContain("Private asset unavailable");
    expect(html).not.toContain("context-use://");
    expect(html).not.toContain("11111111-1111-4111-8111-111111111111");
    expect(html).not.toContain("22222222-2222-4222-8222-222222222222");
  });

  test("renders stable directory references as links to generated indexes", async () => {
    const directoryId = "11111111-1111-4111-8111-111111111111";
    const html = await renderMarkdown(
      `[Life chapters](context-use://directory/${directoryId})`,
      {
        ...privateResolvers,
        directory: async (id) => id === directoryId
          ? { available: true as const, href: `/app/directories/${directoryId}` }
          : { available: false as const },
      },
    );
    expect(html).toContain(`<a href="/app/directories/${directoryId}">Life chapters</a>`);
    expect(html).not.toContain("context-use://");
  });

  test("renders Obsidian wikilinks with aliases and safe internal targets", async () => {
    const html = await renderMarkdown(
      "[[about/intro|My intro]] [[missing/page|Missing page]] [[about/intro|<img src=x onerror=alert(1)>]]",
      {
        ...privateResolvers,
        pagePath: async (path) => path === "about/intro"
          ? { available: true as const, href: "/app/pages/11111111-1111-4111-8111-111111111111" }
          : { available: false as const },
      },
    );
    expect(html).toContain('<a href="/app/pages/11111111-1111-4111-8111-111111111111">My intro</a>');
    expect(html).toContain('<span class="private-reference">Missing page</span>');
    expect(html).not.toContain("[[");
    expect(html).not.toContain("<img");
    expect(html).not.toContain('target="_blank"');
  });

  test("rewrites legacy private routes for public targets and hides private targets", async () => {
    const publicId = "11111111-1111-4111-8111-111111111111";
    const privateId = "22222222-2222-4222-8222-222222222222";
    const html = await renderMarkdown(
      `[Published](/app/pages/${publicId}) [Owner only](/app/pages/${privateId})`,
      {
        ...privateResolvers,
        page: async (id) => id === publicId
          ? { available: true as const, href: "/p/published-page" }
          : { available: false as const },
      },
    );

    expect(html).toContain('<a href="/p/published-page">Published</a>');
    expect(html).toContain('<span class="private-reference">Owner only</span>');
    expect(html).not.toContain("/app/pages/");
    expect(html).not.toContain(privateId);
  });
});
