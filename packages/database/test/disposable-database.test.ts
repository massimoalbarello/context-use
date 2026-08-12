import { describe, expect, test } from "bun:test";
import {
  DISPOSABLE_SETTING,
  assertDisposableDatabase,
  databaseNameFromUrl,
  disposableDatabaseUrl,
  markDisposableSql,
} from "../src/disposable-database.ts";

const databaseUrl = await disposableDatabaseUrl();
const describeDatabase = databaseUrl ? describe : describe.skip;

describe("disposable integration database", () => {
  test("marks a database by name, quoting it", () => {
    expect(markDisposableSql("context_use_test"))
      .toBe(`ALTER DATABASE "context_use_test" SET "${DISPOSABLE_SETTING}" = 'true'`);
    expect(markDisposableSql('od"d')).toBe(`ALTER DATABASE "od""d" SET "${DISPOSABLE_SETTING}" = 'true'`);
  });

  test("reads the database name from query-bearing and encoded connection URLs", () => {
    expect(databaseNameFromUrl("postgres://localhost:5432/context_use_test?sslmode=require")).toBe("context_use_test");
    expect(databaseNameFromUrl("postgres://localhost:5432/context%20use")).toBe("context use");
  });

  test("rejects a connection string it cannot parse", () => {
    expect(() => databaseNameFromUrl("not a url")).toThrow(/not a valid connection URL/);
  });
});

describeDatabase("the disposable mark on a real server", () => {
  test("accepts the marked database and refuses an unmarked one beside it", async () => {
    await expect(assertDisposableDatabase(databaseUrl!)).resolves.toBe(databaseUrl!);

    // Every server has a maintenance database, and nothing ever marks it.
    const unmarked = new URL(databaseUrl!);
    unmarked.pathname = "/postgres";
    await expect(assertDisposableDatabase(unmarked.toString())).rejects.toThrow(/not marked disposable/);
  });
});
