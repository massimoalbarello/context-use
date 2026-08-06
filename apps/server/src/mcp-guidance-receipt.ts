import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config.ts";

export type GuidanceGuideVersion = {
  current_path: string;
  current_version_id: string;
};

const RECEIPT_PREFIX = "cu-guidance-v2";

function guideVersions(guides: GuidanceGuideVersion[]): [string, string][] {
  return guides.map(({ current_path, current_version_id }) => [
    current_path,
    current_version_id,
  ]);
}

function legacyReceiptSignature(guides: GuidanceGuideVersion[]): Buffer {
  const manifest = guides.map(({ current_path, current_version_id }) => [
    current_path,
    current_version_id,
  ]);
  return createHmac("sha256", config.MCP_ASSET_CAPABILITY_SECRET)
    .update("context-use:mcp-guidance:v1\0")
    .update(JSON.stringify(manifest))
    .digest();
}

function receiptSignature(encodedManifest: string): Buffer {
  return createHmac("sha256", config.MCP_ASSET_CAPABILITY_SECRET)
    .update("context-use:mcp-guidance:v2\0")
    .update(encodedManifest)
    .digest();
}

export function createGuidanceReceipt(guides: GuidanceGuideVersion[]): string {
  const manifest = Buffer.from(JSON.stringify(guideVersions(guides))).toString("base64url");
  return `${RECEIPT_PREFIX}.${manifest}.${receiptSignature(manifest).toString("base64url")}`;
}

export function guidanceGuidesFromReceipt(receipt: string): GuidanceGuideVersion[] | null {
  if (receipt.length > 100_000) return null;
  const [prefix, encodedManifest, encodedSignature, ...extra] = receipt.split(".");
  if (prefix !== RECEIPT_PREFIX || !encodedManifest || !encodedSignature || extra.length) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(encodedManifest) || !/^[A-Za-z0-9_-]+$/.test(encodedSignature)) return null;

  const suppliedSignature = Buffer.from(encodedSignature, "base64url");
  if (suppliedSignature.toString("base64url") !== encodedSignature) return null;
  const expectedSignature = receiptSignature(encodedManifest);
  if (suppliedSignature.length !== expectedSignature.length
    || !timingSafeEqual(suppliedSignature, expectedSignature)) return null;

  const manifestBuffer = Buffer.from(encodedManifest, "base64url");
  if (manifestBuffer.toString("base64url") !== encodedManifest) return null;
  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestBuffer.toString("utf8"));
  } catch {
    return null;
  }
  if (!Array.isArray(manifest) || manifest.length > 1_024) return null;

  const paths = new Set<string>();
  const guides: GuidanceGuideVersion[] = [];
  for (const entry of manifest) {
    if (!Array.isArray(entry) || entry.length !== 2) return null;
    const [currentPath, currentVersionId] = entry;
    if (typeof currentPath !== "string" || !currentPath || currentPath.length > 512
      || typeof currentVersionId !== "string" || !currentVersionId || currentVersionId.length > 512
      || paths.has(currentPath)) return null;
    paths.add(currentPath);
    guides.push({ current_path: currentPath, current_version_id: currentVersionId });
  }
  return guides;
}

export function verifyGuidanceReceipt(
  receipt: string,
  guides: GuidanceGuideVersion[],
): boolean {
  const receiptGuides = guidanceGuidesFromReceipt(receipt);
  if (receiptGuides) {
    return JSON.stringify(guideVersions(receiptGuides)) === JSON.stringify(guideVersions(guides));
  }

  // Continue accepting the original opaque receipts so an in-flight agent run does
  // not have to reload unchanged guidance immediately after a server deployment.
  let suppliedLegacy: Buffer;
  try {
    suppliedLegacy = Buffer.from(receipt, "base64url");
  } catch {
    return false;
  }
  const expectedLegacy = legacyReceiptSignature(guides);
  return suppliedLegacy.length === expectedLegacy.length
    && timingSafeEqual(suppliedLegacy, expectedLegacy);
}
