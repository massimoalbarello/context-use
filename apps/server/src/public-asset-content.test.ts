import { describe, expect, test } from "bun:test";
import type { PublicRepository } from "@context-use/database";
import { createPublicAssetContentHandler } from "./public-asset-content.ts";
import type { ObjectStorage } from "./storage.ts";

const assetPath = "projects/acme/published-image";
const bytes = new TextEncoder().encode("published bytes");

function fixture(published = true) {
  let metadataReads = 0;
  let objectReads = 0;
  let storageReference = "";
  const assets = {
    async assetByPublicPath(path: string) {
      metadataReads += 1;
      return published && path === assetPath ? {
        public_path: path,
        filename: "published.png",
        content_type: "image/png",
        size_bytes: bytes.byteLength,
      } : null;
    },
  } as Pick<PublicRepository, "assetByPublicPath">;
  const storage = {
    async read(reference: string) {
      objectReads += 1;
      storageReference = reference;
      return new Blob([bytes]);
    },
  } as unknown as ObjectStorage;
  const handler = createPublicAssetContentHandler(assets, storage, "https://assets.context.example");
  return {
    handler,
    metadataReads: () => metadataReads,
    objectReads: () => objectReads,
    storageReference: () => storageReference,
  };
}

describe("public asset API boundary", () => {
  test("streams only metadata selected by the published-assets repository", async () => {
    const published = fixture();
    const response = await published.handler(new Request(
      `https://assets.context.example/a/${assetPath}`,
    ), assetPath);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("published bytes");
    expect(response.headers.get("cross-origin-resource-policy")).toBe("cross-origin");
    expect(published.metadataReads()).toBe(1);
    expect(published.objectReads()).toBe(1);
    expect(published.storageReference()).toBe(assetPath);

    const privateAsset = fixture(false);
    const denied = await privateAsset.handler(new Request(
      `https://assets.context.example/a/${assetPath}`,
    ), assetPath);
    expect(denied.status).toBe(404);
    expect(privateAsset.metadataReads()).toBe(1);
    expect(privateAsset.objectReads()).toBe(0);
  });

  test("rejects private credentials and requests on the dashboard origin before metadata access", async () => {
    for (const request of [
      new Request(`https://assets.context.example/a/${assetPath}`, {
        headers: { cookie: "private-session" },
      }),
      new Request(`https://assets.context.example/a/${assetPath}`, {
        headers: { authorization: "Bearer private-token" },
      }),
      new Request(`https://context.example/a/${assetPath}`),
    ]) {
      const denied = fixture();
      expect((await denied.handler(request, assetPath)).status).toBe(404);
      expect(denied.metadataReads()).toBe(0);
      expect(denied.objectReads()).toBe(0);
    }
  });
});
