import { describe, expect, test } from "bun:test";
import { CorpusRecordReader } from "./corpus-records.ts";
import { corpusDirectory } from "./corpus-integrity.ts";
import { batchProgress, servedOffset } from "./distill.ts";
import type { PageSnapshot } from "./snapshot.ts";

/**
 * The two readings a run makes of its own progress, against checkpoints the real reader
 * produced rather than hand-written ones — the format is opaque on purpose, so a test that
 * fabricates it proves nothing about what the harness will see.
 */

const BATCHES = ["2026-04-16", "2026-04-17", "2026-04-18", "2026-04-19"];
const SIZES = new Map(BATCHES.map((batch, index) => [batch, 10 * (index + 1)]));
const TOTAL = [...SIZES.values()].reduce((sum, size) => sum + size, 0);

/** A snapshot holding nothing but the automation's state page, as the harness reads it. */
function stateWith(checkpoint: string | undefined): PageSnapshot[] {
  const body = checkpoint
    ? `# Activity distiller state\n\n**Checkpoint:** \`${checkpoint}\`\n`
    : "# Activity distiller state\n\n**Checkpoint:** _none_\n";
  return [{
    path: "automations/activity-distiller/state",
    title: "Activity distiller state",
    summary: "Opaque checkpoint.",
    body,
    version: 2,
  } as PageSnapshot];
}

/** Reads the corpus forward until the checkpoint names `batch`, and returns it. */
async function checkpointAt(batch: string): Promise<string> {
  const reader = new CorpusRecordReader({ directory: corpusDirectory("amara-life-v1") });
  let checkpoint: string | undefined;
  for (let read = 0; read < 500; read += 1) {
    const result = await reader.read(checkpoint ? { checkpoint } : {});
    checkpoint = result.next_checkpoint;
    if (checkpointNames(checkpoint, batch)) return checkpoint;
  }
  throw new Error(`The reader never checkpointed at ${batch}`);
}

function checkpointNames(checkpoint: string, batch: string): boolean {
  const encoded = checkpoint.slice("cu-corpus-v2.".length);
  const payload = encoded.slice(0, encoded.lastIndexOf("."));
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).batch === batch;
}

describe("reading a batch's progress from the checkpoint", () => {
  test("tells a batch that was finished, abandoned and never reached apart", async () => {
    const atSeventeen = stateWith(await checkpointAt("2026-04-17"));

    // The checkpoint names the batch the next read starts at, so standing at 04-17 means
    // 04-16 is done and 04-17 has not begun.
    expect(batchProgress(atSeventeen, "2026-04-16", BATCHES)).toBe("finished");
    expect(batchProgress(atSeventeen, "2026-04-17", BATCHES)).toBe("inside");

    // The reading that was missing: this session was triggered for 04-18 and never got
    // there, because it spent itself re-reading the batch an earlier failure left behind.
    expect(batchProgress(atSeventeen, "2026-04-18", BATCHES)).toBe("behind");
  });

  test("treats an unreadable or absent checkpoint as unknown rather than finished", () => {
    expect(batchProgress(stateWith(undefined), "2026-04-17", BATCHES)).toBe("unknown");
    expect(batchProgress([], "2026-04-17", BATCHES)).toBe("unknown");
    expect(batchProgress(stateWith("cu-corpus-v2.not-a-checkpoint"), "2026-04-17", BATCHES)).toBe("unknown");
  });
});

describe("counting the records a session was actually served", () => {
  test("measures the distance between two checkpoints, not the batch it was labelled", () => {
    const start = servedOffset(null, BATCHES, SIZES, TOTAL);
    expect(start).toBeNull();

    expect(servedOffset({ batch: "2026-04-16", index: 0 }, BATCHES, SIZES, TOTAL)).toBe(0);
    expect(servedOffset({ batch: "2026-04-17", index: 0 }, BATCHES, SIZES, TOTAL)).toBe(10);
    expect(servedOffset({ batch: "2026-04-17", index: 4 }, BATCHES, SIZES, TOTAL)).toBe(14);
    expect(servedOffset({ batch: "2026-04-18", index: 0 }, BATCHES, SIZES, TOTAL)).toBe(30);

    // A drained corpus stands past every batch; an unknown one supports no claim either way.
    expect(servedOffset({ batch: null, index: 0 }, BATCHES, SIZES, TOTAL)).toBe(TOTAL);
    expect(servedOffset({ batch: "2026-05-01", index: 0 }, BATCHES, SIZES, TOTAL)).toBeNull();
  });

  test("gives a stalled session no credit for the batch it was labelled", () => {
    // What 04-18 and 04-19 did: read fifty records, write almost nothing, leave the
    // checkpoint exactly where it was found. The label moved; the corpus did not.
    const before = servedOffset({ batch: "2026-04-17", index: 0 }, BATCHES, SIZES, TOTAL)!;
    const after = servedOffset({ batch: "2026-04-17", index: 0 }, BATCHES, SIZES, TOTAL)!;
    expect(after - before).toBe(0);

    // An index inside the batch is partial progress and counts as exactly that much.
    const partial = servedOffset({ batch: "2026-04-17", index: 6 }, BATCHES, SIZES, TOTAL)!;
    expect(partial - before).toBe(6);
  });
});
