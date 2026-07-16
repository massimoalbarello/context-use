import { describe, expect, test } from "bun:test";
import { renderMarkdown } from "./markdown.ts";

const privateResolvers = {
  page: async () => ({ available: false as const }),
  asset: async () => ({ available: false as const }),
};

describe("safe Markdown rendering", () => {
  test("removes scripts, event handlers, unsafe URLs, and remote inline media", async () => {
    const html = await renderMarkdown(
      `<script>alert(1)</script>\n<a href="javascript:alert(1)" onclick="alert(1)">bad</a>\n![remote](https://attacker.example/pixel.png)`,
      privateResolvers,
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("attacker.example");
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
});
