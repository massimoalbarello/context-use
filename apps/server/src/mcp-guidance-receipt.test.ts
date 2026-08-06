import { expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { config } from "./config.ts";
import {
  createGuidanceReceipt,
  guidanceGuidesFromReceipt,
  type GuidanceGuideVersion,
  verifyGuidanceReceipt,
} from "./mcp-guidance-receipt.ts";

const guides: GuidanceGuideVersion[] = [
  {
    current_path: "agents",
    current_version_id: "11111111-1111-4111-8111-111111111111",
  },
  {
    current_path: "about/tasks/agents",
    current_version_id: "22222222-2222-4222-8222-222222222222",
  },
];

test("guidance receipts represent the ordered current guide versions", () => {
  const receipt = createGuidanceReceipt(guides);

  expect(receipt).toStartWith("cu-guidance-v2.");
  expect(guidanceGuidesFromReceipt(receipt)).toEqual(guides);
  expect(verifyGuidanceReceipt(receipt, guides.map((guide) => ({ ...guide })))).toBe(true);
  expect(verifyGuidanceReceipt(receipt, guides.toReversed())).toBe(false);
  expect(verifyGuidanceReceipt(receipt, guides.slice(0, 1))).toBe(false);
  expect(verifyGuidanceReceipt(receipt, [
    guides[0]!,
    {
      ...guides[1]!,
      current_version_id: "33333333-3333-4333-8333-333333333333",
    },
  ])).toBe(false);
  expect(verifyGuidanceReceipt("not-a-receipt", guides)).toBe(false);
});

test("rejects a tampered self-describing receipt", () => {
  const receipt = createGuidanceReceipt(guides);
  const [prefix, manifest, signature] = receipt.split(".");
  const decoded = JSON.parse(Buffer.from(manifest!, "base64url").toString("utf8"));
  decoded[1][1] = "33333333-3333-4333-8333-333333333333";
  const tamperedManifest = Buffer.from(JSON.stringify(decoded)).toString("base64url");
  const tampered = `${prefix}.${tamperedManifest}.${signature}`;

  expect(guidanceGuidesFromReceipt(tampered)).toBeNull();
  expect(verifyGuidanceReceipt(tampered, guides)).toBe(false);
});

test("continues accepting legacy receipts for an unchanged exact guide chain", () => {
  const manifest = guides.map(({ current_path, current_version_id }) => [
    current_path,
    current_version_id,
  ]);
  const legacyReceipt = createHmac("sha256", config.MCP_ASSET_CAPABILITY_SECRET)
    .update("context-use:mcp-guidance:v1\0")
    .update(JSON.stringify(manifest))
    .digest("base64url");

  expect(guidanceGuidesFromReceipt(legacyReceipt)).toBeNull();
  expect(verifyGuidanceReceipt(legacyReceipt, guides)).toBe(true);
  expect(verifyGuidanceReceipt(legacyReceipt, guides.slice(0, 1))).toBe(false);
});
