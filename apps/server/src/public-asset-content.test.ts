import { describe, expect, test } from "bun:test";
import type { PublicRepository } from "@context-use/database";
import { createPublicAssetContentHandler } from "./public-asset-content.ts";
import type { ObjectStorage } from "./storage.ts";

const assetId = "11111111-1111-4111-8111-111111111111";
const bytes = new TextEncoder().encode("published bytes");

function fixture(published = true) {
  let metadataReads = 0;
  let objectReads = 0;
  const assets = {
    async asset(id: string) {
      metadataReads += 1;
      return published && id === assetId ? {
        id,
        filename: "published.png",
        content_type: "image/png",
        size_bytes: bytes.byteLength,
        s3_object_key: `objects/${assetId}`,
      } : null;
    },
  } as Pick<PublicRepository, "asset">;
  const storage = {
    async read() {
      objectReads += 1;
      return new Blob([bytes]);
    },
  } as unknown as ObjectStorage;
  const handler = createPublicAssetContentHandler(assets, storage, "https://assets.context.example");
  return { handler, metadataReads: () => metadataReads, objectReads: () => objectReads };
}

describe("public asset API boundary", () => {
  test("streams only metadata selected by the published-assets repository", async () => {
    const published = fixture();
    const response = await published.handler(new Request(
      `https://assets.context.example/api/public/assets/${assetId}/content`,
    ), assetId);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("published bytes");
    expect(response.headers.get("cross-origin-resource-policy")).toBe("cross-origin");
    expect(published.metadataReads()).toBe(1);
    expect(published.objectReads()).toBe(1);

    const privateAsset = fixture(false);
    const denied = await privateAsset.handler(new Request(
      `https://assets.context.example/api/public/assets/${assetId}/content`,
    ), assetId);
    expect(denied.status).toBe(404);
    expect(privateAsset.metadataReads()).toBe(1);
    expect(privateAsset.objectReads()).toBe(0);
  });

  test("rejects private credentials and requests on the dashboard origin before metadata access", async () => {
    for (const request of [
      new Request(`https://assets.context.example/api/public/assets/${assetId}/content`, {
        headers: { cookie: "private-session" },
      }),
      new Request(`https://assets.context.example/api/public/assets/${assetId}/content`, {
        headers: { authorization: "Bearer private-token" },
      }),
      new Request(`https://context.example/api/public/assets/${assetId}/content`),
    ]) {
      const denied = fixture();
      expect((await denied.handler(request, assetId)).status).toBe(404);
      expect(denied.metadataReads()).toBe(0);
      expect(denied.objectReads()).toBe(0);
    }
  });
});
