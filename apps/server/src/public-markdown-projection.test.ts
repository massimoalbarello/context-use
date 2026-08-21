import { describe, expect, test } from "bun:test";
import { projectPublicMarkdown } from "./public-markdown-projection.ts";

describe("public Markdown artifacts", () => {
  test("projects only independently public targets and removes private identifiers and HTML", () => {
    const privatePage = "11111111-1111-4111-8111-111111111111";
    const publicPage = "22222222-2222-4222-8222-222222222222";
    const directory = "33333333-3333-4333-8333-333333333333";
    const privateAsset = "44444444-4444-4444-8444-444444444444";
    const publicAsset = "55555555-5555-4555-8555-555555555555";
    const markdown = [
      `[Public](context-use://page/${publicPage}#hello)`,
      `[Private](context-use://page/${privatePage}#secret)`,
      `[Directory](context-use://directory/${directory})`,
      "[[profile-home#background|Profile section]]",
      "[[private/strategy|Strategy]]",
      `![Public image](context-use://asset/${publicAsset}){size=medium}`,
      `![Private image](context-use://asset/${privateAsset})`,
      `/api/mcp/assets/${privateAsset}/content`,
      `unrecognized:${privatePage}`,
      "<!-- hidden -->",
      "<script>hidden()</script>",
      "<span data-private=hidden>Visible text</span>",
    ].join("\n\n");

    const projected = projectPublicMarkdown(markdown, "profile/work/project", {
      pageTargets: [{ id: publicPage, source_path: "profile-home", public_path: "profile" }],
      assetTargets: [{ id: publicAsset, public_path: "media/public-image" }],
      directoryTargets: [{ id: directory, path: "profile/work" }],
    });

    expect(projected).toContain("[Public](/p/profile#hello)");
    expect(projected).toContain("Private");
    expect(projected).not.toContain("#secret");
    expect(projected).toContain("[Directory](/p/profile/work/)");
    expect(projected).toContain("[Profile section](/p/profile#background)");
    expect(projected).toContain("Strategy");
    expect(projected).toContain("![Public image](context-use://public-asset/media/public-image){size=medium}");
    expect(projected).toContain("Private image");
    expect(projected).toContain("Visible text");
    expect(projected).not.toContain("hidden");
    expect(projected).not.toContain(privatePage);
    expect(projected).not.toContain(privateAsset);
    expect(projected).not.toContain("/api/mcp/assets/");
  });
});
