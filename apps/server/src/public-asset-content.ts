import type { PublicRepository } from "@context-use/database";
import { z } from "zod";
import { assetContentResponse } from "./asset-content.ts";
import { requestMatchesOrigin, securityHeaders } from "./security.ts";
import type { ObjectStorage } from "./storage.ts";

function notFound(): Response {
  return new Response("Not found", { status: 404, headers: securityHeaders });
}

export function createPublicAssetContentHandler(
  assets: Pick<PublicRepository, "asset">,
  storage: ObjectStorage,
  publicAssetOrigin: string,
) {
  return async (request: Request, rawAssetId: string): Promise<Response> => {
    if (
      !requestMatchesOrigin(request, publicAssetOrigin)
      || request.headers.has("cookie")
      || request.headers.has("authorization")
    ) return notFound();

    const assetId = z.string().uuid().safeParse(rawAssetId);
    if (!assetId.success) return notFound();
    const asset = await assets.asset(assetId.data);
    if (!asset) return notFound();
    return assetContentResponse(request, asset, storage, true);
  };
}
