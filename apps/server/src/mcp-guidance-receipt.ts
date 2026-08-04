import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config.ts";

export type GuidanceGuideVersion = {
  current_path: string;
  current_version_id: string;
};

function receiptSignature(guides: GuidanceGuideVersion[]): Buffer {
  const guideVersions = guides.map(({ current_path, current_version_id }) => [
    current_path,
    current_version_id,
  ]);
  return createHmac("sha256", config.MCP_ASSET_CAPABILITY_SECRET)
    .update("context-use:mcp-guidance:v1\0")
    .update(JSON.stringify(guideVersions))
    .digest();
}

export function createGuidanceReceipt(guides: GuidanceGuideVersion[]): string {
  return receiptSignature(guides).toString("base64url");
}

export function verifyGuidanceReceipt(
  receipt: string,
  guides: GuidanceGuideVersion[],
): boolean {
  let supplied: Buffer;
  try {
    supplied = Buffer.from(receipt, "base64url");
  } catch {
    return false;
  }
  const expected = receiptSignature(guides);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
