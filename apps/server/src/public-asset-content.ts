import type { PublicRepository } from "@context-use/database";
import { AssetPath } from "@context-use/shared";
import { assetContentResponse } from "./asset-content.ts";
import { requestMatchesOrigin, securityHeaders } from "./security.ts";
import type { ObjectStorage } from "./storage.ts";

function notFound(): Response {
  return new Response("Not found", { status: 404, headers: securityHeaders });
}

export function createPublicAssetContentHandler(
  assets: Pick<PublicRepository, "assetByPublicPath">,
  storage: ObjectStorage,
  publicAssetOrigin: string,
) {
  return async (request: Request, rawPublicPath: string): Promise<Response> => {
    if (
      !requestMatchesOrigin(request, publicAssetOrigin)
      || request.headers.has("cookie")
      || request.headers.has("authorization")
    ) return notFound();

    const publicPath = AssetPath.safeParse(rawPublicPath);
    if (!publicPath.success) return notFound();
    const asset = await assets.assetByPublicPath(publicPath.data);
    if (!asset) return notFound();
    const response = await assetContentResponse(request, asset, storage, true);
    // Published assets are deliberately hosted on a separate origin, but are
    // embedded by public pages on the application origin.
    response.headers.set("cross-origin-resource-policy", "cross-origin");
    return response;
  };
}
