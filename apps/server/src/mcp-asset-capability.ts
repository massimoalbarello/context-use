import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { config } from "./config.ts";

export type AssetCapabilityAction = "upload" | "download";

const CAPABILITY_SECONDS: Record<AssetCapabilityAction, number> = {
  upload: 15 * 60,
  download: 5 * 60,
};

const capabilityPayloadSchema = z.object({
  version: z.literal(1),
  action: z.enum(["upload", "download"]),
  assetId: z.string().uuid(),
  expiresAt: z.number().int().positive(),
}).strict();

type CapabilityPayload = z.infer<typeof capabilityPayloadSchema>;

function signature(encodedPayload: string): Buffer {
  return createHmac("sha256", config.MCP_ASSET_CAPABILITY_SECRET)
    .update("context-use:mcp-asset:v1\0")
    .update(encodedPayload)
    .digest();
}

export function createAssetCapability(
  action: AssetCapabilityAction,
  assetId: string,
  now = Date.now(),
): { token: string; expiresAt: string } {
  const payload: CapabilityPayload = {
    version: 1,
    action,
    assetId: z.string().uuid().parse(assetId),
    expiresAt: Math.floor(now / 1000) + CAPABILITY_SECONDS[action],
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return {
    token: `${encodedPayload}.${signature(encodedPayload).toString("base64url")}`,
    expiresAt: new Date(payload.expiresAt * 1000).toISOString(),
  };
}

export function verifyAssetCapability(
  token: string,
  action: AssetCapabilityAction,
  now = Date.now(),
): CapabilityPayload | null {
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
  if (
    !parsed.success
    || parsed.data.action !== action
    || parsed.data.expiresAt <= Math.floor(now / 1000)
  ) return null;
  return parsed.data;
}
