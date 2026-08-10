# Local knowledge evals

Three things live here.

**Corpus distillation** (`bun run eval distill`) runs the activity distiller over a fixed,
vendored corpus, one automation run per corpus batch, and reports the pages it wrote. This
is the write path end to end: the private MCP serves the corpus through the production
`read_source_records` tool, and the agent follows the automation instructions installed in
the knowledge base. There is no evaluation-specific prompt and no evaluation-specific tool.

**Question answering** (`bun run eval qa:ask`, `qa:score`) puts questions to the knowledge
base a distillation run built and compares each answer to a sealed key — the read path. See
[qa/README.md](qa/README.md).

**Scenario scoring** (`bun run eval run`) is the earlier, hand-written four-step
trajectory with deterministic assertions about entities, timelines and reconciliation. It
will be replaced by scoring over corpus batches, at which point the hand-written scenario
goes away.

## Two corpora

Both are copied verbatim from [`garrytan/gbrain-evals`][upstream] and never edited — see
[corpus/UPSTREAM.md](corpus/UPSTREAM.md) for the pinned commits and how integrity is
enforced.

| | `amara-life-v1` | `world-v1` |
| --- | --- | --- |
| What it is | raw activity: email, Slack, calendar, meetings, notes | 240 already-distilled biographical pages |
| Size | 418 items over 47 days | 240 pages over 10 batches |
| Measures | extraction, distillation and retrieval | prose reconciliation and retrieval |
| Answer key | entities and meetings ([gold/](gold/README.md)) | 145 questions ([qa/](qa/README.md)) |
| Scored by | `gold:check` | `qa:score` |

`amara-life-v1` is the corpus that matches what Context Use actually does. `world-v1` is
the easier and narrower one, and it is here because **it is the only corpus upstream ships
with a populated answer key** — every `gold/*.json` file for `amara-life-v1` is still an
empty stub with a single `_example` row, and the question sets upstream does populate are
keyed to `world-v1` slugs.

```sh
bun run eval corpus:verify --corpus world-v1     # working copy against <id>.lock.json
bun run eval corpus:refresh --corpus world-v1    # working copy against the pinned commit
```

Both are read-only. Re-pinning a corpus has to be a deliberate commit, because changing it
invalidates every result measured against the previous version.

## Running the distillation

```sh
bun run local up
bun run eval connect codex
bun run eval distill --corpus world-v1 --batches 2
```

A **batch** is what one automation run consumes. For `amara-life-v1` a batch is a calendar
day; for `world-v1` it is a slice of the page order, since those pages carry no chronology
of their own and dating them would invent one. `--batches N` stops after N of them, which
is how to try a corpus cheaply — `world-v1` is 10 runs over 240 pages, the amara dense
window is 8 runs over 379 records, and the full amara corpus is 47. `--days` is accepted
as an alias where a batch is a day.

`--window dense` selects amara's eight busy days; `full` walks all 47. It selects a span of
days, so asking for it on `world-v1` fails rather than quietly serving everything.

`--corpus` and `--window` are the single source of truth. The server reads both at startup,
so the run exports them, resets the stack, and then reads them back out of the running
container before the first agent run. A client and server that disagree would label batches
the server never served — or score a `world-v1` run against amara's key — so the run fails
instead.

Every run resets semantic knowledge and assets in this local instance to the default
template while preserving the owner passkey and OAuth authorization. Do not keep
development data in it. Snapshots, per-batch agent logs and a Markdown report land in
`.eval-results/`.

## What counts as one source record

One upstream item is one record. For `amara-life-v1` that is 418 manifest items and 418
records, and `loadCorpus` fails if any manifest item is not carried, so nothing can be
silently dropped. For `world-v1` it is 240 pages; its two non-content files —
`_ledger.json`, generation metadata, and `world.html`, a rendered explorer — are vendored
because the corpus is copied verbatim, and never served.

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

## How one run equals one batch

`CorpusRecordReader` in [corpus-records.ts](corpus-records.ts) implements the same
`SourceRecordReader` interface as the Nango pipeline, so `read_source_records` behaves
exactly as it does in production — opaque checkpoints, `has_more` batching, and the
automation persisting its own checkpoint into `automations/activity-distiller/state`.

The one difference is where a batch ends. `has_more` stays true only while the current
corpus batch still has records; when it is exhausted the checkpoint advances to the next
one. An automation run therefore consumes one batch and stops, the way a scheduled
production run consumes whatever the source produced since its last checkpoint. The
harness just triggers the next run.

What a batch *means* belongs to the corpus, and nothing above that layer needs to know.
`amara-life-v1` is a time series, so a batch is a calendar day. `world-v1` is a set of
biographical pages, so a batch is a stride of ten over the slug-sorted order — giving
every batch the same proportional mix of people, companies, meetings and concepts. A
contiguous slice would serve all 80 companies before any of the people who work at them
and measure ordering rather than capability; a date would invent a chronology the corpus
does not have.

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
