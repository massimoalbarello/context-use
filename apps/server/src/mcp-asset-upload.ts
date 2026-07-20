import type { AssetRepository } from "@context-use/database";
import { z } from "zod";
import { config } from "./config.ts";
import { verifyAssetCapability } from "./mcp-asset-capability.ts";
import { requestMatchesOrigin, securityHeaders } from "./security.ts";
import { AssetIntegrityError, type ObjectStorage } from "./storage.ts";

function problem(message: string, status: number, code: string): Response {
  return Response.json({ error: code, message }, { status, headers: securityHeaders });
}

export function createMcpAssetUploadHandler(
  assets: AssetRepository,
  storage: ObjectStorage,
) {
  return async (request: Request, assetId: string): Promise<Response> => {
    if (!requestMatchesOrigin(request, config.APP_ORIGIN)) {
      return problem("Asset upload capability is not accepted on this origin", 401, "invalid_upload_capability");
    }
    if (request.headers.has("cookie") || request.headers.has("authorization")) {
      return problem("Only an MCP-issued asset upload capability is accepted", 401, "invalid_upload_capability");
    }
    const capability = verifyAssetCapability(request.headers.get("x-context-use-upload-token") ?? "", "upload");
    if (!capability || capability.assetId !== assetId) {
      return problem("Asset upload capability is invalid or expired", 401, "invalid_upload_capability");
    }

    const asset = await assets.get(z.string().uuid().parse(assetId), true);
    if (!asset) return problem("Asset not found", 404, "not_found");
    const expectedSize = Number(asset.size_bytes);
    const suppliedSize = request.headers.get("content-length");
    if (suppliedSize !== null && (!/^\d+$/.test(suppliedSize) || Number(suppliedSize) !== expectedSize)) {
      return problem("Asset size mismatch", 422, "integrity_error");
    }
    if (request.headers.get("content-type")?.toLowerCase() !== asset.content_type.toLowerCase()) {
      return problem("Asset content type mismatch", 422, "integrity_error");
    }
    if (!request.body && expectedSize !== 0) return problem("Asset size mismatch", 422, "integrity_error");
    try {
      await storage.write({
        id: asset.id,
        objectKey: asset.s3_object_key,
        filename: asset.filename,
        contentType: asset.content_type,
        sizeBytes: expectedSize,
        contentHash: asset.content_hash,
      }, request.body);
    } catch (error) {
      if (error instanceof AssetIntegrityError) return problem(error.message, 422, "integrity_error");
      throw error;
    }
    return Response.json({ uploaded: true, asset_id: asset.id }, { headers: securityHeaders });
  };
}
