import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { AssetRepository } from "@context-use/database";
import { z } from "zod";
import { assetContentResponse } from "./asset-content.ts";
import { config } from "./config.ts";
import { requestMatchesOrigin, securityHeaders } from "./security.ts";
import type { ObjectStorage } from "./storage.ts";

const DOWNLOAD_CAPABILITY_SECONDS = 5 * 60;

const capabilityPayloadSchema = z.object({
  version: z.literal(1),
  assetId: z.string().uuid(),
  clientId: z.string().min(1),
  userId: z.string().min(1),
  nonce: z.string().uuid(),
  expiresAt: z.number().int().positive(),
}).strict();

type CapabilityPayload = z.infer<typeof capabilityPayloadSchema>;

function signature(encodedPayload: string): Buffer {
  return createHmac("sha256", config.BETTER_AUTH_SECRET)
    .update("context-use:mcp-asset-download:v1\0")
    .update(encodedPayload)
    .digest();
}

export function createAssetDownloadCapability(
  input: { assetId: string; clientId: string; userId: string },
  now = Date.now(),
): { token: string; expiresAt: string } {
  const payload: CapabilityPayload = {
    version: 1,
    assetId: input.assetId,
    clientId: input.clientId,
    userId: input.userId,
    nonce: randomUUID(),
    expiresAt: Math.floor(now / 1000) + DOWNLOAD_CAPABILITY_SECONDS,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return {
    token: `${encodedPayload}.${signature(encodedPayload).toString("base64url")}`,
    expiresAt: new Date(payload.expiresAt * 1000).toISOString(),
  };
}

export function verifyAssetDownloadCapability(token: string, now = Date.now()): CapabilityPayload | null {
  const [encodedPayload, encodedSignature, extra] = token.split(".");
  if (!encodedPayload || !encodedSignature || extra !== undefined) return null;
  let supplied: Buffer;
  try {
    supplied = Buffer.from(encodedSignature, "base64url");
  } catch {
    return null;
  }
  const expected = signature(encodedPayload);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const parsed = capabilityPayloadSchema.safeParse(payload);
  if (!parsed.success || parsed.data.expiresAt <= Math.floor(now / 1000)) return null;
  return parsed.data;
}

function problem(message: string, status: number, code: string): Response {
  return Response.json({ error: code, message }, { status, headers: securityHeaders });
}

export function createMcpAssetDownloadHandler(
  assets: AssetRepository,
  storage: ObjectStorage,
  grantIsActive: (clientId: string, userId: string, scopes: ReadonlySet<string>) => Promise<boolean>,
) {
  return async (request: Request, assetId: string): Promise<Response> => {
    if (!requestMatchesOrigin(request, config.APP_ORIGIN)) {
      return problem("Asset download capability is not accepted on this origin", 401, "invalid_download_capability");
    }
    if (request.headers.has("cookie") || request.headers.has("authorization")) {
      return problem("Only an MCP-issued asset download capability is accepted", 401, "invalid_download_capability");
    }
    const capability = verifyAssetDownloadCapability(request.headers.get("x-context-use-download-token") ?? "");
    if (!capability || capability.assetId !== assetId) {
      return problem("Asset download capability is invalid or expired", 401, "invalid_download_capability");
    }
    if (!(await grantIsActive(capability.clientId, capability.userId, new Set(["assets:read"])))) {
      return problem("The MCP asset-read grant is inactive", 401, "inactive_oauth_grant");
    }

    const asset = await assets.get(z.string().uuid().parse(assetId), true);
    if (!asset) return problem("Asset not found", 404, "not_found");
    return assetContentResponse(request, asset, storage, false);
  };
}
