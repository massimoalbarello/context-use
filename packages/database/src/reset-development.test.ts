import { describe, expect, test } from "bun:test";
import { DEVELOPMENT_RESET_TABLES, developmentResetSql } from "./reset-development.ts";

describe("development data reset", () => {
  test("clears knowledge state without touching owner authentication", () => {
    expect(DEVELOPMENT_RESET_TABLES).toContain("knowledge_pages");
    expect(DEVELOPMENT_RESET_TABLES).toContain("assets");

    const sql = developmentResetSql().toLowerCase();
    for (const protectedTable of ["user", "session", "account", "passkey", "oauthclient"]) {
      expect(sql).not.toContain(`truncate table ${protectedTable}`);
      expect(DEVELOPMENT_RESET_TABLES).not.toContain(protectedTable as never);
    }
  });

  test("recreates the root required by the default template", () => {
    expect(developmentResetSql()).toContain("INSERT INTO knowledge_directories");
    expect(developmentResetSql()).toContain("gen_random_uuid(),''");
  });
});
