import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config.ts";

export type KnowledgeGuideRevision = {
  documentId: string;
  revisionId: string;
};

export type KnowledgeGuideReceiptContext = {
  clientId: string;
  sessionId: string;
};

/**
 * Compatibility shape for the path-scoped guidance contract. It remains exported while
 * deployed automation instructions can still call `prepare_change`; the hypermedia
 * cutover removes this contract after those instructions have been rewritten.
 */
export type GuidanceGuideVersion = {
  current_path: string;
  current_version_id: string;
};

const RECEIPT_PREFIX = "cu-knowledge-guide-v1";
const GUIDANCE_RECEIPT_PREFIX = "cu-guidance-v3";
const MAX_RECEIPT_LENGTH = 8_192;
const MAX_GUIDANCE_RECEIPT_LENGTH = 100_000;
const MAX_CONTEXT_ID_LENGTH = 512;
const MAX_GUIDE_CHAIN_LENGTH = 1_024;
const MAX_GUIDE_VALUE_LENGTH = 512;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type ReceiptManifest = [
  documentId: string,
  revisionId: string,
  clientId: string,
  sessionId: string,
];

type GuidanceReceiptManifest = [
  guides: [path: string, revisionId: string][],
  clientId: string,
  sessionId: string,
];

function validContextId(value: string): boolean {
  return value.length >= 1 && value.length <= MAX_CONTEXT_ID_LENGTH;
}

function manifest(
  guide: KnowledgeGuideRevision,
  context: KnowledgeGuideReceiptContext,
): ReceiptManifest {
  if (!UUID.test(guide.documentId) || !UUID.test(guide.revisionId)) {
    throw new Error("Knowledge guide document and revision IDs must be UUIDs");
  }
  if (!validContextId(context.clientId) || !validContextId(context.sessionId)) {
    throw new Error("Knowledge guide receipt context is invalid");
  }
  return [guide.documentId, guide.revisionId, context.clientId, context.sessionId];
}

function receiptSignature(encodedManifest: string): Buffer {
  return createHmac("sha256", config.MCP_ASSET_CAPABILITY_SECRET)
    .update("context-use:mcp-knowledge-guide:v1\0")
    .update(encodedManifest)
    .digest();
}

export function createKnowledgeGuideReceipt(
  guide: KnowledgeGuideRevision,
  context: KnowledgeGuideReceiptContext,
): string {
  const encodedManifest = Buffer.from(JSON.stringify(manifest(guide, context)), "utf8")
    .toString("base64url");
  return `${RECEIPT_PREFIX}.${encodedManifest}.${receiptSignature(encodedManifest).toString("base64url")}`;
}

function receiptManifest(receipt: string): ReceiptManifest | null {
  if (receipt.length > MAX_RECEIPT_LENGTH) return null;
  const [prefix, encodedManifest, encodedSignature, ...extra] = receipt.split(".");
  if (prefix !== RECEIPT_PREFIX || !encodedManifest || !encodedSignature || extra.length) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(encodedManifest) || !/^[A-Za-z0-9_-]+$/.test(encodedSignature)) {
    return null;
  }

  const suppliedSignature = Buffer.from(encodedSignature, "base64url");
  if (suppliedSignature.toString("base64url") !== encodedSignature) return null;
  const expectedSignature = receiptSignature(encodedManifest);
  if (suppliedSignature.length !== expectedSignature.length
    || !timingSafeEqual(suppliedSignature, expectedSignature)) return null;

  const manifestBuffer = Buffer.from(encodedManifest, "base64url");
  if (manifestBuffer.toString("base64url") !== encodedManifest) return null;
  let value: unknown;
  try {
    value = JSON.parse(manifestBuffer.toString("utf8"));
  } catch {
    return null;
  }
  if (!Array.isArray(value) || value.length !== 4) return null;
  const [documentId, revisionId, clientId, sessionId] = value;
  if (typeof documentId !== "string" || !UUID.test(documentId)
    || typeof revisionId !== "string" || !UUID.test(revisionId)
    || typeof clientId !== "string" || !validContextId(clientId)
    || typeof sessionId !== "string" || !validContextId(sessionId)) return null;
  return [documentId, revisionId, clientId, sessionId];
}

export function verifyKnowledgeGuideReceipt(
  receipt: string,
  guide: KnowledgeGuideRevision,
  context: KnowledgeGuideReceiptContext,
): boolean {
  let expected: ReceiptManifest;
  try {
    expected = manifest(guide, context);
  } catch {
    return false;
  }
  const actual = receiptManifest(receipt);
  return actual !== null
    && actual.every((value, index) => value === expected[index]);
}

function guideVersions(guides: GuidanceGuideVersion[]): [string, string][] {
  return guides.map(({ current_path, current_version_id }) => [
    current_path,
    current_version_id,
  ]);
}

function validGuideVersions(value: unknown): value is [string, string][] {
  if (!Array.isArray(value) || value.length > MAX_GUIDE_CHAIN_LENGTH) return false;
  const paths = new Set<string>();
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length !== 2) return false;
    const [currentPath, currentVersionId] = entry;
    if (typeof currentPath !== "string" || !currentPath
      || currentPath.length > MAX_GUIDE_VALUE_LENGTH
      || typeof currentVersionId !== "string" || !currentVersionId
      || currentVersionId.length > MAX_GUIDE_VALUE_LENGTH
      || paths.has(currentPath)) return false;
    paths.add(currentPath);
  }
  return true;
}

function guidanceManifest(
  guides: GuidanceGuideVersion[],
  context: KnowledgeGuideReceiptContext,
): GuidanceReceiptManifest {
  const versions = guideVersions(guides);
  if (!validGuideVersions(versions)) throw new Error("Guidance guide chain is invalid");
  if (!validContextId(context.clientId) || !validContextId(context.sessionId)) {
    throw new Error("Guidance receipt context is invalid");
  }
  return [versions, context.clientId, context.sessionId];
}

function guidanceSignature(encodedManifest: string): Buffer {
  return createHmac("sha256", config.MCP_ASSET_CAPABILITY_SECRET)
    .update("context-use:mcp-guidance:v3\0")
    .update(encodedManifest)
    .digest();
}

/** @deprecated Transitional support for `prepare_change`. */
export function createGuidanceReceipt(
  guides: GuidanceGuideVersion[],
  context: KnowledgeGuideReceiptContext,
): string {
  const encodedManifest = Buffer.from(JSON.stringify(guidanceManifest(guides, context)), "utf8")
    .toString("base64url");
  const receipt = `${GUIDANCE_RECEIPT_PREFIX}.${encodedManifest}.${guidanceSignature(encodedManifest).toString("base64url")}`;
  if (receipt.length > MAX_GUIDANCE_RECEIPT_LENGTH) {
    throw new Error("Guidance receipt exceeds the supported size");
  }
  return receipt;
}

/** @deprecated Transitional support for `prepare_change`. */
export function guidanceGuidesFromReceipt(
  receipt: string,
  context: KnowledgeGuideReceiptContext,
): GuidanceGuideVersion[] | null {
  if (receipt.length > MAX_GUIDANCE_RECEIPT_LENGTH
    || !validContextId(context.clientId) || !validContextId(context.sessionId)) return null;
  const [prefix, encodedManifest, encodedSignature, ...extra] = receipt.split(".");
  if (prefix !== GUIDANCE_RECEIPT_PREFIX || !encodedManifest || !encodedSignature || extra.length) {
    return null;
  }
  if (!/^[A-Za-z0-9_-]+$/.test(encodedManifest)
    || !/^[A-Za-z0-9_-]+$/.test(encodedSignature)) return null;

  const suppliedSignature = Buffer.from(encodedSignature, "base64url");
  if (suppliedSignature.toString("base64url") !== encodedSignature) return null;
  const expectedSignature = guidanceSignature(encodedManifest);
  if (suppliedSignature.length !== expectedSignature.length
    || !timingSafeEqual(suppliedSignature, expectedSignature)) return null;

  const manifestBuffer = Buffer.from(encodedManifest, "base64url");
  if (manifestBuffer.toString("base64url") !== encodedManifest) return null;
  let value: unknown;
  try {
    value = JSON.parse(manifestBuffer.toString("utf8"));
  } catch {
    return null;
  }
  if (!Array.isArray(value) || value.length !== 3) return null;
  const [versions, clientId, sessionId] = value;
  if (!validGuideVersions(versions)
    || typeof clientId !== "string" || !validContextId(clientId)
    || typeof sessionId !== "string" || !validContextId(sessionId)
    || clientId !== context.clientId || sessionId !== context.sessionId) return null;
  return versions.map(([currentPath, currentVersionId]) => ({
    current_path: currentPath,
    current_version_id: currentVersionId,
  }));
}

/** @deprecated Transitional support for `prepare_change`. */
export function verifyGuidanceReceipt(
  receipt: string,
  guides: GuidanceGuideVersion[],
  context: KnowledgeGuideReceiptContext,
): boolean {
  const receiptGuides = guidanceGuidesFromReceipt(receipt, context);
  return receiptGuides !== null
    && JSON.stringify(guideVersions(receiptGuides)) === JSON.stringify(guideVersions(guides));
}
