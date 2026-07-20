import type { AssetRepository } from "@context-use/database";
import { z } from "zod";
import { assetContentResponse } from "./asset-content.ts";
import { config } from "./config.ts";
import { verifyAssetCapability } from "./mcp-asset-capability.ts";
import { requestMatchesOrigin, securityHeaders } from "./security.ts";
import type { ObjectStorage } from "./storage.ts";

function problem(message: string, status: number, code: string): Response {
  return Response.json({ error: code, message }, { status, headers: securityHeaders });
}

export function createMcpAssetDownloadHandler(
  assets: AssetRepository,
  storage: ObjectStorage,
) {
  return async (request: Request, assetId: string): Promise<Response> => {
    if (!requestMatchesOrigin(request, config.APP_ORIGIN)) {
      return problem("Asset download capability is not accepted on this origin", 401, "invalid_download_capability");
    }
    if (request.headers.has("cookie") || request.headers.has("authorization")) {
      return problem("Only an MCP-issued asset download capability is accepted", 401, "invalid_download_capability");
    }
    const capability = verifyAssetCapability(request.headers.get("x-context-use-download-token") ?? "", "download");
    if (!capability || capability.assetId !== assetId) {
      return problem("Asset download capability is invalid or expired", 401, "invalid_download_capability");
    }

    const asset = await assets.get(z.string().uuid().parse(assetId), true);
    if (!asset) return problem("Asset not found", 404, "not_found");
    return assetContentResponse(request, asset, storage, false);
  };
}
