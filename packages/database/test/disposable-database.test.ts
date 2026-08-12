import { describe, expect, test } from "bun:test";
import { assertDisposableDatabaseUrl, databaseNameFromUrl } from "../src/disposable-database.ts";

describe("disposable integration database", () => {
  test("accepts a database named for disposal", () => {
    const url = "postgres://postgres:postgres@localhost:5432/context_use_test";
    expect(assertDisposableDatabaseUrl(url)).toBe(url);
  });

  test("rejects the installation database the local stack and evals use", () => {
    expect(() => assertDisposableDatabaseUrl("postgres://postgres:postgres@localhost:5432/context_use"))
      .toThrow(/"context_use" database, which is not disposable/);
  });

  test("rejects a connection that names no database", () => {
    expect(() => assertDisposableDatabaseUrl("postgres://postgres:postgres@localhost:5432"))
      .toThrow(/default database, which is not disposable/);
  });

  test("rejects a database whose name merely contains the suffix", () => {
    expect(() => assertDisposableDatabaseUrl("postgres://localhost:5432/context_use_testimonials"))
      .toThrow(/not disposable/);
  });

  test("reads the database name from query-bearing and encoded connection URLs", () => {
    expect(databaseNameFromUrl("postgres://localhost:5432/context_use_test?sslmode=require")).toBe("context_use_test");
    expect(databaseNameFromUrl("postgres://localhost:5432/context%20use_test")).toBe("context use_test");
  });

  test("rejects a connection string it cannot parse", () => {
    expect(() => assertDisposableDatabaseUrl("not a url")).toThrow(/not a valid connection URL/);
  });
});
