import { expect, test } from "bun:test";
import {
  createGuidanceReceipt,
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
