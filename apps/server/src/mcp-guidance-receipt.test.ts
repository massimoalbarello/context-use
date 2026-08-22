import { expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { config } from "./config.ts";
import {
  createGuidanceReceipt,
  createKnowledgeGuideReceipt,
  type GuidanceGuideVersion,
  guidanceGuidesFromReceipt,
  type KnowledgeGuideReceiptContext,
  type KnowledgeGuideRevision,
  verifyGuidanceReceipt,
  verifyKnowledgeGuideReceipt,
} from "./mcp-guidance-receipt.ts";

const guide: KnowledgeGuideRevision = {
  documentId: "11111111-1111-4111-8111-111111111111",
  revisionId: "22222222-2222-4222-8222-222222222222",
};

const context: KnowledgeGuideReceiptContext = {
  clientId: "mcp-client",
  sessionId: "mcp-session",
};

test("knowledge guide receipts bind one guide revision to one MCP session", () => {
  const receipt = createKnowledgeGuideReceipt(guide, context);
  const [, encodedManifest] = receipt.split(".");

  expect(receipt).toStartWith("cu-knowledge-guide-v1.");
  expect(JSON.parse(Buffer.from(encodedManifest!, "base64url").toString("utf8"))).toEqual([
    guide.documentId,
    guide.revisionId,
    context.clientId,
    context.sessionId,
  ]);
  expect(verifyKnowledgeGuideReceipt(receipt, { ...guide }, { ...context })).toBe(true);
  expect(verifyKnowledgeGuideReceipt(receipt, {
    ...guide,
    revisionId: "33333333-3333-4333-8333-333333333333",
  }, context)).toBe(false);
  expect(verifyKnowledgeGuideReceipt(receipt, {
    ...guide,
    documentId: "44444444-4444-4444-8444-444444444444",
  }, context)).toBe(false);
  expect(verifyKnowledgeGuideReceipt(receipt, guide, {
    ...context,
    clientId: "another-client",
  })).toBe(false);
  expect(verifyKnowledgeGuideReceipt(receipt, guide, {
    ...context,
    sessionId: "another-session",
  })).toBe(false);
});

test("rejects a tampered knowledge guide receipt", () => {
  const receipt = createKnowledgeGuideReceipt(guide, context);
  const [prefix, encodedManifest, signature] = receipt.split(".");
  const decoded = JSON.parse(Buffer.from(encodedManifest!, "base64url").toString("utf8"));
  decoded[1] = "33333333-3333-4333-8333-333333333333";
  const tamperedManifest = Buffer.from(JSON.stringify(decoded)).toString("base64url");
  const tampered = `${prefix}.${tamperedManifest}.${signature}`;

  expect(verifyKnowledgeGuideReceipt(tampered, guide, context)).toBe(false);
  expect(verifyKnowledgeGuideReceipt(`${receipt}x`, guide, context)).toBe(false);
  expect(verifyKnowledgeGuideReceipt("not-a-receipt", guide, context)).toBe(false);
});

test("rejects invalid guide or context inputs", () => {
  expect(() => createKnowledgeGuideReceipt({
    ...guide,
    documentId: "not-a-document-id",
  }, context)).toThrow("Knowledge guide document and revision IDs must be UUIDs");
  expect(() => createKnowledgeGuideReceipt(guide, {
    ...context,
    sessionId: "",
  })).toThrow("Knowledge guide receipt context is invalid");

  const receipt = createKnowledgeGuideReceipt(guide, context);
  expect(verifyKnowledgeGuideReceipt(receipt, {
    ...guide,
    revisionId: "not-a-revision-id",
  }, context)).toBe(false);
});

const guidanceChain: GuidanceGuideVersion[] = [{
  current_path: "agents",
  current_version_id: "22222222-2222-4222-8222-222222222222",
}, {
  current_path: "people/agents",
  current_version_id: "33333333-3333-4333-8333-333333333333",
}];

test("scoped guidance receipts bind the exact guide chain to one MCP session", () => {
  const receipt = createGuidanceReceipt(guidanceChain, context);
  const [, encodedManifest] = receipt.split(".");

  expect(receipt).toStartWith("cu-guidance-v3.");
  expect(JSON.parse(Buffer.from(encodedManifest!, "base64url").toString("utf8"))).toEqual([
    guidanceChain.map(({ current_path, current_version_id }) => [
      current_path,
      current_version_id,
    ]),
    context.clientId,
    context.sessionId,
  ]);
  expect(guidanceGuidesFromReceipt(receipt, context)).toEqual(guidanceChain);
  expect(verifyGuidanceReceipt(receipt, guidanceChain, context)).toBe(true);
  expect(verifyGuidanceReceipt(receipt, guidanceChain.toReversed(), context)).toBe(false);
  expect(verifyGuidanceReceipt(receipt, [{
    ...guidanceChain[0]!,
    current_version_id: "44444444-4444-4444-8444-444444444444",
  }, guidanceChain[1]!], context)).toBe(false);

  const otherClient = { ...context, clientId: "another-client" };
  const otherSession = { ...context, sessionId: "another-session" };
  expect(guidanceGuidesFromReceipt(receipt, otherClient)).toBeNull();
  expect(guidanceGuidesFromReceipt(receipt, otherSession)).toBeNull();
  expect(verifyGuidanceReceipt(receipt, guidanceChain, otherClient)).toBe(false);
  expect(verifyGuidanceReceipt(receipt, guidanceChain, otherSession)).toBe(false);
});

test("does not authorize unbound v1 or v2 scoped guidance receipts", () => {
  const versions = guidanceChain.map(({ current_path, current_version_id }) => [
    current_path,
    current_version_id,
  ]);
  const encodedManifest = Buffer.from(JSON.stringify(versions), "utf8").toString("base64url");
  const v2Signature = createHmac("sha256", config.MCP_ASSET_CAPABILITY_SECRET)
    .update("context-use:mcp-guidance:v2\0")
    .update(encodedManifest)
    .digest("base64url");
  const v2Receipt = `cu-guidance-v2.${encodedManifest}.${v2Signature}`;
  const v1Receipt = createHmac("sha256", config.MCP_ASSET_CAPABILITY_SECRET)
    .update("context-use:mcp-guidance:v1\0")
    .update(JSON.stringify(versions))
    .digest("base64url");

  expect(guidanceGuidesFromReceipt(v2Receipt, context)).toBeNull();
  expect(verifyGuidanceReceipt(v2Receipt, guidanceChain, context)).toBe(false);
  expect(verifyGuidanceReceipt(v1Receipt, guidanceChain, context)).toBe(false);
});

test("rejects invalid scoped guide chains or context inputs", () => {
  expect(() => createGuidanceReceipt(guidanceChain, {
    ...context,
    sessionId: "",
  })).toThrow("Guidance receipt context is invalid");
  expect(() => createGuidanceReceipt([
    guidanceChain[0]!,
    { ...guidanceChain[1]!, current_path: guidanceChain[0]!.current_path },
  ], context)).toThrow("Guidance guide chain is invalid");

  const receipt = createGuidanceReceipt(guidanceChain, context);
  expect(guidanceGuidesFromReceipt(receipt, { ...context, clientId: "" })).toBeNull();
});
