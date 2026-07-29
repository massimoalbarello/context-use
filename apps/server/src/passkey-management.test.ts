import { describe, expect, test } from "bun:test";
import { parseEnrollmentContext } from "./passkey-management.ts";

describe("passkey enrollment claims", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const token = "a".repeat(43);

  test("accepts only the bounded one-time enrollment context shape", () => {
    expect(parseEnrollmentContext(JSON.stringify({
      enrollment_claim: `${id}.${token}`,
    }))).toEqual({ id, token });
  });

  for (const invalid of [
    null,
    "",
    "{}",
    JSON.stringify({ enrollment_claim: `${id}.short` }),
    JSON.stringify({ enrollment_claim: `${id}.${token}`, extra: true }),
    JSON.stringify({ enrollment_claim: `not-a-uuid.${token}` }),
  ]) {
    test(`rejects invalid context ${String(invalid)}`, () => {
      expect(parseEnrollmentContext(invalid)).toBeNull();
    });
  }
});
