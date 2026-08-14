import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ReleaseBadge, releaseLabel } from "./RunningRelease.tsx";

describe("running release", () => {
  test("formats the health version as a release tag", () => {
    expect(releaseLabel("0.1.68")).toBe("v0.1.68");
    expect(releaseLabel("v0.1.68")).toBe("v0.1.68");
  });

  test("shows the release in a labelled Settings badge", () => {
    const html = renderToStaticMarkup(<ReleaseBadge version="0.1.68" />);
    expect(html).toContain('aria-label="Running release"');
    expect(html).toContain("Release");
    expect(html).toContain("v0.1.68");
  });

  test("shows a quiet fallback when health metadata is unavailable", () => {
    const html = renderToStaticMarkup(<ReleaseBadge version={null} />);
    expect(html).toContain("Unavailable");
  });
});
