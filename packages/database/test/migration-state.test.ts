import { describe, expect, test } from "bun:test";
import { assertMigrationState } from "../src/migration-state.ts";

const files = [{ version: "001_baseline.sql", checksum: "current-checksum" }];

describe("flattened migration state", () => {
  test("accepts a fresh database and an exactly matching baseline", () => {
    expect(() => assertMigrationState(files, [], [])).not.toThrow();
    expect(() => assertMigrationState(files, [
      { version: "001_baseline.sql", checksum: "current-checksum" },
    ], ["knowledge_pages"])).not.toThrow();
  });

  test("fails closed for removed legacy migrations", () => {
    expect(() => assertMigrationState(files, [
      { version: "001_baseline.sql", checksum: null },
      { version: "006_legacy.sql", checksum: null },
    ], ["knowledge_pages"])).toThrow("fresh database");
  });

  test("fails closed for an old or modified baseline", () => {
    expect(() => assertMigrationState(files, [
      { version: "001_baseline.sql", checksum: null },
    ], ["knowledge_pages"])).toThrow("no recorded checksum");
    expect(() => assertMigrationState(files, [
      { version: "001_baseline.sql", checksum: "old-checksum" },
    ], ["knowledge_pages"])).toThrow("does not match this release");
  });

  test("does not baseline over untracked relations", () => {
    expect(() => assertMigrationState(files, [], ["knowledge_pages"]))
      .toThrow("can only be applied to a fresh database");
  });
});
