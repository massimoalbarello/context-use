# Local knowledge evals

Two things live here.

**Corpus distillation** (`bun run eval distill`) runs the activity distiller over a fixed,
vendored corpus, one automation run per corpus day, and reports the pages it wrote. This
is the write path end to end: the private MCP serves the corpus through the production
`read_source_records` tool, and the agent follows the automation instructions installed in
the knowledge base. There is no evaluation-specific prompt and no evaluation-specific tool.
It does not score anything yet.

**Scenario scoring** (`bun run eval run`) is the earlier, hand-written four-step
trajectory with deterministic assertions about entities, timelines, diary synchronization
and reconciliation. It will be replaced by scoring over corpus days, at which point the
hand-written scenario goes away.

## The corpus

`corpus/amara-life-v1/` is copied verbatim from [`garrytan/gbrain-evals`][upstream] and is
never edited — see [corpus/UPSTREAM.md](corpus/UPSTREAM.md) for the pinned commit and how
integrity is enforced. 418 items over 47 days: 300 Slack messages, 50 emails, 40 notes, 20
calendar events and 8 meetings. Thirty-nine days hold one note each; the eight days from
13 to 20 April 2026 hold 379 of the 418 items.

```sh
bun run eval corpus:verify    # working copy against corpus.lock.json
bun run eval corpus:refresh   # working copy against the pinned upstream commit
```

Both are read-only. Re-pinning the corpus has to be a deliberate commit, because changing
it invalidates every result measured against the previous version.

## Running the distillation

```sh
bun run local up
bun run eval connect codex
bun run eval distill --window dense --days 2
```

`--window dense` selects the eight busy days; `full` walks all 47. `--days N` stops after
N days, which is how to try it cheaply — the full dense window is eight agent runs over
379 records, and the full corpus is 47.

`--window` is the single source of truth. The server reads the window at startup, so the
run exports it, resets the stack with it, and then reads it back out of the running
container before the first agent run. A client and server that disagree would label days
the server never served, so the run fails instead.

Every run resets semantic knowledge and assets in this local instance to the default
template while preserving the owner passkey and OAuth authorization. Do not keep
development data in it. Snapshots, per-day agent logs and a Markdown report land in
`.eval-results/`.

## What counts as one source record

A conversation is one record, not one record per message, because the Nango envelope
contract is a source item carrying a complete semantic body — the same reason a meeting is
one record. The 418 upstream items become 226 records: 300 Slack messages collapse into
130, and 50 emails into 28. Notes, meetings and calendar events are already single items
and are unchanged. `loadCorpus` fails if any manifest item is not carried by some record,
so grouping can never silently drop evidence.

Slack threads are keyed by **channel and `thread_ts` together**, not `thread_ts` alone.
This corpus reuses one `thread_ts` across all four channels for unrelated subjects, so
grouping on it alone would splice a fund close, a deal update and office chat into a single
"conversation". Keyed by channel the groups are two or three messages and read as threads.

A thread that gains messages on a later day is served again that day, `added` the first
time and `updated` after, carrying the whole conversation each time. That is how an
incremental source behaves, it keeps later messages out of an earlier day, and it means a
thread is never split across batches. Thirteen records in this corpus are updates.

`doc/` holds six reference documents that are **not** in the upstream manifest and are
therefore never served. That matches upstream's own definition of the corpus, and no other
record references them.

## How one run equals one day

`CorpusRecordReader` implements the same `SourceRecordReader` interface as the Nango
pipeline and is selected in `mcp-app.ts` when `EVAL_CORPUS_PATH` is set, so
`read_source_records` behaves exactly as it does in production — opaque checkpoints,
`has_more` batching, and the automation persisting its own checkpoint into
`automations/activity-distiller/state`.

The one difference is where a batch ends. `has_more` stays true only while the current
corpus day still has records; when the day is exhausted the checkpoint advances to the
next day that has any. An automation run therefore consumes one day and stops, the way a
scheduled production run consumes whatever the source produced since its last checkpoint.
The harness just triggers the next run.

Nango's 30-day source-freshness window is deliberately absent rather than disabled by a
flag. It belongs to Nango's semantics, because Nango backfills historical records; a fixed
corpus does not. Nothing in the production reader branches on evaluation mode, and corpus
dates are served exactly as authored.

`EVAL_CORPUS_PATH` and `EVAL_CORPUS_WINDOW` are rejected outright in production by the
config boundary, in every service.

## Fixture attribution

The fictional Amara Okafor world is from [`garrytan/gbrain-evals`][upstream], used under
its MIT License. The corpus is served unmodified, including its inline entity references
such as `[Ravi Gupta](people/ravi-gupta)`: those are upstream's own paths, and rewriting
them would both modify the corpus and disadvantage any system whose extraction is built to
read them.

[upstream]: https://github.com/garrytan/gbrain-evals
