import { describe, expect, test } from "bun:test";
import {
  beginPasskeyRemovalTransaction,
  parseEnrollmentContext,
  revokeOwnerAuthentication,
} from "./passkey-management.ts";

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

describe("owner authentication revocation", () => {
  test("takes the owner transaction lock immediately after BEGIN", async () => {
    const calls: Array<{ statement: string; values: unknown[] | undefined }> = [];
    const client = {
      query: async (statement: string, values?: unknown[]) => {
        calls.push({ statement: statement.replace(/\s+/g, " ").trim(), values });
        return { rowCount: 1, rows: [] };
      },
    };

    await beginPasskeyRemovalTransaction(client as never);

    expect(calls).toEqual([
      { statement: "BEGIN", values: undefined },
      {
        statement: "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        values: ["context-use-owner"],
      },
    ]);
  });

  test("revokes refresh and access tokens before deleting sessions", async () => {
    const statements: string[] = [];
    const database = {
      query: async (statement: string, values: unknown[]) => {
        statements.push(statement.replace(/\s+/g, " ").trim());
        expect(values).toEqual(["owner"]);
        return { rowCount: 1, rows: [] };
      },
    };

    await revokeOwnerAuthentication(database as never, "owner");

    expect(statements).toHaveLength(3);
    expect(statements[0]).toContain('UPDATE "oauthRefreshToken"');
    expect(statements[0]).toContain("rotationReplayResponse");
    expect(statements[1]).toContain('UPDATE "oauthAccessToken"');
    expect(statements[2]).toContain('DELETE FROM "session"');
  });
});
