import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AssetDetails, assetPreviewKind } from "./Assets.tsx";

describe("asset previews", () => {
  test("previews browser-safe images, videos, and PDFs", () => {
    expect(assetPreviewKind("image/png")).toBe("image");
    expect(assetPreviewKind("IMAGE/JPEG")).toBe("image");
    expect(assetPreviewKind("video/mp4")).toBe("video");
    expect(assetPreviewKind("video/quicktime")).toBe("video");
    expect(assetPreviewKind("application/pdf")).toBe("pdf");
  });

  test("does not inline active or unsupported formats", () => {
    expect(assetPreviewKind("image/svg+xml")).toBeNull();
    expect(assetPreviewKind("video/x-msvideo")).toBeNull();
    expect(assetPreviewKind("text/html")).toBeNull();
  });
});

describe("asset references", () => {
  test("shows the asset's canonical private document reference", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const html = renderToStaticMarkup(createElement(AssetDetails, {
      asset: {
        id,
        current_path: "media/portrait",
        public_path: null,
        filename: "portrait.jpg",
        content_type: "image/jpeg",
        size_bytes: 1024,
        content_hash: "a".repeat(64),
        created_at: "2026-08-22T00:00:00.000Z",
      },
      onChanged: () => undefined,
      onDeleted: () => undefined,
    }));

    expect(html).toContain(`context-use://document/${id}`);
    expect(html).not.toContain("context-use://asset/");
  });
});
