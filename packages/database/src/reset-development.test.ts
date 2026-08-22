import { describe, expect, test } from "bun:test";
import { DEVELOPMENT_RESET_TABLES, developmentResetSql } from "./reset-development.ts";

describe("development data reset", () => {
  test("clears knowledge state without touching owner authentication", () => {
    expect(DEVELOPMENT_RESET_TABLES).toContain("knowledge_pages");
    expect(DEVELOPMENT_RESET_TABLES).toContain("assets");
    expect(DEVELOPMENT_RESET_TABLES).toContain("source_records");
    expect(DEVELOPMENT_RESET_TABLES).toContain("source_record_search_chunks");
    expect(DEVELOPMENT_RESET_TABLES).toContain("hypermedia_documents");
    expect(DEVELOPMENT_RESET_TABLES).toContain("public_resources");

    const sql = developmentResetSql().toLowerCase();
    for (const protectedTable of ["user", "session", "account", "passkey", "oauthclient"]) {
      expect(sql).not.toContain(`truncate table ${protectedTable}`);
      expect(DEVELOPMENT_RESET_TABLES).not.toContain(protectedTable as never);
    }
  });

  test("recreates the root required by the default template", () => {
    expect(developmentResetSql()).toContain("INSERT INTO knowledge_directories");
    expect(developmentResetSql()).toContain("gen_random_uuid(),''");
    expect(developmentResetSql()).toContain("INSERT INTO knowledge_settings(singleton)");
    expect(developmentResetSql()).toContain("INSERT INTO public_projection_state(singleton)");
  });
});
