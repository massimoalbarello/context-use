import { describe, expect, test } from "bun:test";
import type { Pool } from "pg";
import { PageRepository } from "./pages.ts";

function row(sequence: string, pageId: string, path: string) {
  return {
    change_sequence: sequence,
    page_id: pageId,
    version_id: crypto.randomUUID(),
    version_number: Number(sequence),
    change_kind: "updated" as const,
    path,
    title: path,
    commit_message: `Update ${path}`,
    actor_kind: "mcp" as const,
    actor_subject: "client/session",
    changed_at: new Date("2026-08-06T10:00:00.000Z"),
  };
}

describe("durable page change cursor", () => {
  test("keeps pagination inside one fixed window and returns an opaque completion cursor", async () => {
    const calls: Array<{ sql: string; values: unknown[] | undefined }> = [];
    const query = async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      if (sql.includes("GREATEST")) return { rows: [{ change_sequence: "12" }] };
      if (sql === "BEGIN" || sql === "COMMIT" || sql.includes("pg_advisory_xact_lock")) {
        return { rows: [] };
      }
      const position = values?.[2];
      return position === "5"
        ? { rows: [row("9", crypto.randomUUID(), "about/intro"), row("11", crypto.randomUUID(), "people/alex")] }
        : { rows: [row("11", crypto.randomUUID(), "people/alex")] };
    };
    const pool = {
      query,
      async connect() {
        return { query, release() {} };
      },
    } as unknown as Pool;
    const pages = new PageRepository(pool);

    const first = await pages.changesSince({ cursor: "cu-page-changes-v1.5", limit: 1 });
    expect(first).toMatchObject({
      changes: [{ cursor: "cu-page-changes-v1.9", path: "about/intro" }],
      next_cursor: "cu-page-changes-v1.c",
      has_more: true,
    });
    expect(first.next_page_token).toBe("cu-page-scan-v1.5.c.9");

    const second = await pages.changesSince({ pageToken: first.next_page_token!, limit: 1 });
    expect(second).toMatchObject({
      changes: [{ cursor: "cu-page-changes-v1.b", path: "people/alex" }],
      next_cursor: "cu-page-changes-v1.c",
      has_more: false,
    });
    expect(second.next_page_token).toBeUndefined();
    expect(calls.filter(({ sql }) => sql.includes("GREATEST"))).toHaveLength(1);
    expect(calls.some(({ sql }) => sql.includes("pg_advisory_xact_lock"))).toBe(true);
    expect(calls.at(-1)?.values).toEqual(["5", "12", "9", 2]);
  });

  test("rejects mixing a completed cursor with an in-progress page token", async () => {
    const pages = new PageRepository({} as Pool);
    await expect(pages.changesSince({
      cursor: "cu-page-changes-v1.1",
      pageToken: "cu-page-scan-v1.0.1.0",
    })).rejects.toThrow("Provide a cursor or page token, not both");
  });
});
