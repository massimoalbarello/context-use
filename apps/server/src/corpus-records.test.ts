import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { CorpusRecordReader, loadCorpus } from "./corpus-records.ts";
import { SourceRecordCheckpointError } from "./nango-records.ts";

function note(date: string, body: string): string {
  return `---\nid: note-${date}\ndate: ${date}\n---\n\n${body}\n`;
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** A miniature corpus with the same layout and manifest contract as the vendored one. */
function buildCorpus(options: { corruptNote?: boolean } = {}): string {
  const directory = mkdtempSync(join(tmpdir(), "corpus-"));
  mkdirSync(join(directory, "notes"));
  mkdirSync(join(directory, "inbox"));
  mkdirSync(join(directory, "slack"));

  const first = note("2026-04-13", "First day note.");
  const second = note("2026-04-15", "Third day note.");
  writeFileSync(join(directory, "notes", "a.md"), options.corruptNote ? `${first}edited` : first);
  writeFileSync(join(directory, "notes", "b.md"), second);

  writeFileSync(join(directory, "inbox", "emails.jsonl"), `${[
    JSON.stringify({
      slug: "emails/em-0", ts: "2026-04-13T09:00:00.000Z",
      from: { name: "A", email: "a@example.com" }, to: [{ name: "B", email: "b@example.com" }],
      subject: "Hello", thread_id: "thr-0", in_reply_to: null, body_text: "Body text.",
    }),
    JSON.stringify({
      slug: "emails/em-1", ts: "2026-04-14T09:00:00.000Z",
      from: { name: "B", email: "b@example.com" }, to: [],
      subject: "Reply", thread_id: "thr-0", in_reply_to: "em-0", body_text: "Reply text.",
    }),
  ].join("\n")}\n`);

  writeFileSync(join(directory, "slack", "messages.jsonl"), `${JSON.stringify({
    slug: "slack/sl-0", ts: "2026-04-13T10:00:00.000Z", channel: "#general",
    user: { name: "A", handle: "a" }, thread_ts: null, text: "Message text.",
  })}\n`);

  writeFileSync(join(directory, "calendar.ics"), [
    "BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:evt-0@example.com",
    "DTSTART:20260414T010000Z", "DTEND:20260414T013000Z", "SUMMARY:Sync",
    "ATTENDEE;CN=A:mailto:a@example.com", "END:VEVENT", "END:VCALENDAR", "",
  ].join("\n"));

  writeFileSync(join(directory, "corpus-manifest.json"), JSON.stringify({
    schema_version: 1,
    corpus_id: "test-corpus",
    license: "MIT",
    items: [
      { slug: "note/a", path: "notes/a.md", type: "note", content_sha256: digest(first) },
      { slug: "note/b", path: "notes/b.md", type: "note", content_sha256: digest(second) },
      { slug: "emails/em-0", path: "inbox/emails.jsonl", type: "email", content_sha256: digest("em-0") },
      { slug: "emails/em-1", path: "inbox/emails.jsonl", type: "email", content_sha256: digest("em-1") },
      { slug: "slack/sl-0", path: "slack/messages.jsonl", type: "slack", content_sha256: digest("sl-0") },
      { slug: "cal/evt-0", path: "calendar.ics", type: "calendar-event", content_sha256: digest("evt-0") },
    ],
  }));
  return directory;
}

async function drainDay(reader: CorpusRecordReader, checkpoint?: string) {
  const slugs: string[] = [];
  let batches = 0;
  let cursor = checkpoint;
  for (;;) {
    const result = await reader.read(cursor ? { checkpoint: cursor } : {});
    batches += 1;
    cursor = result.next_checkpoint;
    slugs.push(...result.records.map((record) => record.record_ref.split(":").at(-1)!));
    if (!result.has_more) return { slugs, batches, checkpoint: cursor };
  }
}

describe("corpus source records", () => {
  test("orders records by timestamp and groups them into corpus days", () => {
    const corpus = loadCorpus(buildCorpus());
    expect(corpus.corpusId).toBe("test-corpus");
    expect(corpus.days).toEqual(["2026-04-13", "2026-04-14", "2026-04-15"]);
    // em-0 and em-1 share a thread, so the thread is served once per day it gains a message.
    expect(corpus.records.map((record) => [record.slug, record.day, record.action])).toEqual([
      ["note/a", "2026-04-13", "added"],
      ["emails/em-0", "2026-04-13", "added"],
      ["slack/sl-0", "2026-04-13", "added"],
      ["cal/evt-0", "2026-04-14", "added"],
      ["emails/em-0", "2026-04-14", "updated"],
      ["note/b", "2026-04-15", "added"],
    ]);
  });

  test("carries every manifest item exactly once across its records", () => {
    const carried = loadCorpus(buildCorpus()).records.flatMap((record) => record.itemSlugs);
    expect(carried.sort()).toEqual([
      "cal/evt-0", "emails/em-0", "emails/em-1", "note/a", "note/b", "slack/sl-0",
    ]);
  });

  test("renders a thread as one body carrying every message so far", () => {
    const corpus = loadCorpus(buildCorpus());
    const [added, updated] = corpus.records.filter((record) => record.slug === "emails/em-0");
    expect(added!.markdown).toContain("Body text.");
    expect(added!.markdown).not.toContain("Reply text.");
    // The update repeats the whole conversation rather than only the new message.
    expect(updated!.markdown).toContain("Body text.");
    expect(updated!.markdown).toContain("Reply text.");
  });

  test("rejects a corpus whose file no longer matches the upstream manifest", () => {
    expect(() => loadCorpus(buildCorpus({ corruptNote: true })))
      .toThrow(/does not match the upstream manifest hash/);
  });

  test("serves exactly one day per run and advances to the next", async () => {
    const reader = new CorpusRecordReader({ directory: buildCorpus() });
    expect(reader.days).toEqual(["2026-04-13", "2026-04-14", "2026-04-15"]);

    const first = await drainDay(reader);
    expect(first.slugs).toEqual(["note/a", "emails/em-0", "slack/sl-0"]);

    // The thread keeps its identity across days, so the same record_ref returns updated.
    const second = await drainDay(reader, first.checkpoint);
    expect(second.slugs).toEqual(["cal/evt-0", "emails/em-0"]);

    const third = await drainDay(reader, second.checkpoint);
    expect(third.slugs).toEqual(["note/b"]);

    // Past the final day the reader is exhausted and stays that way.
    const exhausted = await reader.read({ checkpoint: third.checkpoint });
    expect(exhausted.records).toEqual([]);
    expect(exhausted.has_more).toBe(false);
  });

  test("keeps has_more true across batches within one day", async () => {
    const reader = new CorpusRecordReader({ directory: buildCorpus() });
    const first = await reader.read({ limit: 2 });
    expect(first.records).toHaveLength(2);
    expect(first.has_more).toBe(true);

    const second = await reader.read({ checkpoint: first.next_checkpoint, limit: 2 });
    expect(second.records).toHaveLength(1);
    // The day is complete, so the run ends even though later days remain.
    expect(second.has_more).toBe(false);
  });

  test("restricts the dense window to the busy days", async () => {
    const reader = new CorpusRecordReader({ directory: buildCorpus(), window: "dense" });
    // The miniature corpus predates the real dense boundary, so every day survives.
    expect(reader.days).toEqual(["2026-04-13", "2026-04-14", "2026-04-15"]);
  });

  test("serves authored Markdown verbatim and renders structured sources", async () => {
    const reader = new CorpusRecordReader({ directory: buildCorpus() });
    const { records } = await reader.read({});
    const noteRecord = records.find((record) => record.record_ref.endsWith("note/a"))!;
    expect(noteRecord.source).toBe("Notes");
    expect(noteRecord.action).toBe("added");
    expect(noteRecord.markdown).toContain("date: 2026-04-13");
    expect(noteRecord.markdown).toContain("First day note.");

    const emailRecord = records.find((record) => record.record_ref.endsWith("emails/em-0"))!;
    expect(emailRecord.source).toBe("Email");
    expect(emailRecord.markdown).toContain("# Hello");
    expect(emailRecord.markdown).toContain("**From:** A <a@example.com>");
    expect(emailRecord.markdown).toContain("Body text.");
  });

  test("rejects a tampered or foreign checkpoint", async () => {
    const reader = new CorpusRecordReader({ directory: buildCorpus() });
    expect(reader.read({ checkpoint: "cu-corpus-v1.not-a-real-checkpoint" }))
      .rejects.toThrow(SourceRecordCheckpointError);

    const other = new CorpusRecordReader({ directory: buildCorpus() });
    const stolen = await other.read({});
    // Same corpus id here, so tamper with the payload instead.
    const tampered = `${stolen.next_checkpoint.slice(0, -1)}${stolen.next_checkpoint.at(-1) === "a" ? "b" : "a"}`;
    expect(reader.read({ checkpoint: tampered })).rejects.toThrow(SourceRecordCheckpointError);
  });
});
