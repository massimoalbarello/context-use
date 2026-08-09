# Local knowledge evals

Two things live here.

**Corpus distillation** (`bun run eval distill`) runs the activity distiller over a fixed,
vendored corpus, one automation run per corpus day, and reports the pages it wrote. This
is the write path end to end: the private MCP serves the corpus through the production
`read_source_records` tool, and the agent follows the automation instructions installed in
the knowledge base. There is no evaluation-specific prompt and no evaluation-specific tool.
It does not score anything yet.

**Scenario scoring** (`bun run eval run`) is the earlier, hand-written four-step
trajectory with deterministic assertions about entities, timelines and reconciliation. It
runs in two phases: each step writes entity pages and dated timeline entries, then the
diary composer runs once over the change ledger and its output is scored separately, in
the direction the links actually run — diary to entity, never back. It will be replaced by
scoring over corpus days, at which point the hand-written scenario goes away.

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

One manifest item is one record: 418 items, 418 records. `loadCorpus` fails if any
manifest item is not carried, so nothing can be silently dropped.

The obvious alternative — group a thread into one record, the way a meeting already is
one record — is wrong for this corpus, because **its threading carries no meaning**.
Upstream's generator sets `thread_id` to `floor(index / 2)` over emails whose
counterparties are drawn independently at random, and `thread_ts` to a bucket of every
tenth Slack message across four channels that rotate by index. Its prose generator then
wrote every item in isolation: it was handed `In-Reply-To: em-0000` and
`Thread parent: <timestamp>` as bare identifiers, never the text being replied to, and
instructed to "acknowledge thread context".

That is why `thr-0000` is Ravi introducing Terraform Dynamics followed by Amara thanking
Bill about Terraform Industries, and why a fund-close announcement draws two replies
agreeing about timeline concerns nobody raised. Twenty-four of the twenty-five declared
email threads pair messages that share no entity at all. Grouping them, or even printing
the thread id as a header, would assert a relationship the corpus does not contain and
would then penalise a knowledge base for not inventing it.

So the renderer adds no threading header of its own. Upstream's own subject line still
reads `Thread thr-0000 re Ravi` and is served verbatim, because the subject is the
message's own content — but nothing beyond the message itself is promoted into the body.

Every record is `added`. A fixed corpus never revises an item it has already served.

`doc/` holds six reference documents that are **not** in the upstream manifest and are
therefore never served. That matches upstream's own definition of the corpus, and no other
record references them.

## What upstream planted, and what it did not

The corpus is a deliberately messy week, and knowing which mess is deliberate matters.
Upstream's generator seeded **10 contradictions, 5 stale facts, 5 prompt-injection
payloads and 3 implicit preferences**, and left `fixture_id` markers on the items carrying
them. Ten of those markers survive into the vendored JSONL; the rest were designed for
meetings and notes, whose front matter has no field to carry a marker. The markers live in
the envelope and are never rendered into a record body, so they are answer key the agent
cannot read.

Everything else that looks broken is a generator artifact, not a test: the threading
above, `linked_calendar` (which is `cal/evt-{index * 2}` and points at the wrong event all
five times it appears), the twelve note topics regenerated from a one-word hint rather than
continued, and the entity sprawl — upstream designed a cast of sixteen, and the prose
generator, told to write `[Name](people/slug)` without a closed vocabulary, invented
thirty-seven more people. `bun run eval gold:profile` reports both sets separately.

## How one run equals one day

`CorpusRecordReader` in [corpus-records.ts](corpus-records.ts) implements the same
`SourceRecordReader` interface as the Nango pipeline, so `read_source_records` behaves
exactly as it does in production — opaque checkpoints, `has_more` batching, and the
automation persisting its own checkpoint into `automations/activity-distiller/state`.

The one difference is where a batch ends. `has_more` stays true only while the current
corpus day still has records; when the day is exhausted the checkpoint advances to the
next day that has any. An automation run therefore consumes one day and stops, the way a
scheduled production run consumes whatever the source produced since its last checkpoint.
The harness just triggers the next run.

Nango's 30-day source-freshness window is deliberately absent rather than disabled by a
flag. It belongs to Nango's semantics, because Nango backfills historical records; a fixed
corpus does not. Nothing in the production reader branches on evaluation mode, and corpus
dates are served exactly as authored.

## Keeping the harness out of production

Nothing under `eval/` reaches a production deployment, by three independent means.

The reader lives here rather than in `apps/server/src`, and the production image copies
only `apps/`, `packages/` and one file from `nango-integrations/` — so
`corpus-records.ts` is not in the image at all. `mcp-app.ts` reaches it through a
specifier assembled at runtime, so it is not in the module graph and a production bundle
does not contain it either; only the six-line loader survives bundling. And
`EVAL_CORPUS_PATH` and `EVAL_CORPUS_WINDOW` are rejected outright in production by the
config boundary, in every service, so the loader never runs there.

Development bind-mounts the repository at `/app`, so the specifier resolves normally.

The one thing the harness borrows from production is the `SourceRecordReader` interface
in `apps/server/src/nango-records.ts`. That direction is correct: the contract belongs to
production and the evaluation implements it, not the other way round.

## Fixture attribution

The fictional Amara Okafor world is from [`garrytan/gbrain-evals`][upstream], used under
its MIT License. The corpus is served unmodified, including its inline entity references
such as `[Ravi Gupta](people/ravi-gupta)`: those are upstream's own paths, and rewriting
them would both modify the corpus and disadvantage any system whose extraction is built to
read them.

[upstream]: https://github.com/garrytan/gbrain-evals
