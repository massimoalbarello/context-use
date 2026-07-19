import { describe, expect, test } from "bun:test";
import { renderMarkdown } from "./markdown.ts";

const privateResolvers = {
  page: async () => ({ available: false as const }),
  pagePath: async () => ({ available: false as const }),
  asset: async () => ({ available: false as const }),
};

describe("safe Markdown rendering", () => {
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
