import { describe, expect, test } from "bun:test";
import { assetPreviewKind } from "./Assets.tsx";

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
