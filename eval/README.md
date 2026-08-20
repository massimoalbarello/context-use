# Local knowledge evals

Five things live here.

**Corpus distillation** (`bun run eval distill`) runs the activity distiller over a fixed,
vendored corpus, one automation run per corpus batch, and reports the pages it wrote. This
is the write path end to end: the private MCP serves the corpus through the production
`read_source_records` tool, and the agent follows the automation instructions installed in
the knowledge base. There is no evaluation-specific prompt and no evaluation-specific tool.

**Question answering** (`bun run eval qa:ask`, `qa:score`) puts questions to a knowledge
base and compares each answer to a sealed key — the read path. `world-v1` is seeded, so it
measures retrieval alone; `amara-life-v1` is distilled first, so it measures distillation
and retrieval together. See [the shared QA runner](runner/qa/README.md).

**LongMemEval QA** (`bun run eval longmem:run`, `longmem:score`) measures the same write and
read paths as one end-to-end accuracy: distill one complete conversation history, let a
fresh agent search the resulting knowledge iteratively, and score its answer with the
benchmark's official QA rubric. Its large pinned dataset is cached outside git, and every
top-level case gets an independent reset. See [the LongMemEval package](data/longmemeval-v1/README.md).

**LoCoMo QA** (`bun run eval locomo:run`, `locomo:score`) measures those same paths against
the benchmark the agentic-memory papers report. Its unit is a whole conversation rather than
a single question: one dated conversation is distilled, then all ~105–260 of its questions
are asked against that one knowledge base, and the stack resets for the next conversation.
It is scored three ways — LoCoMo's own token F1, A-mem's differently-computed F1 and BLEU,
and an optional LLM judge — because A-mem's published table is not the official metric and
neither deterministic metric can tell a retrieval failure from a verbose answer. See
[the LoCoMo package](data/locomo-v1/README.md).

**Interactive story writing** (`bun run eval story:run`, `journey:run`) gives an agent
short, dated user conversations and scores the connected knowledge it creates after every
turn. [`steve-jobs-v1`](data/steve-jobs-v1/README.md) treats Context Use as Steve Jobs's
second brain across the iMac, iPod, iTunes, and iPhone years. Subjects are resolved from
names, dates, facts, and graph relationships rather than expected filenames or titles.
Their semantic homes are still scored: people under `people/`, companies under `companies/`,
meetings under `meetings/`, and events under `events/`.

## One configuration per run

[`config.json`](config.json) names the harness, model, knowledge template, and evaluation a
run uses.
Every command below takes its defaults from it, so what gets measured is a property of the
repository rather than of the command line someone happened to type.

```sh
bun run eval check      # prove this setup can run that evaluation
bun run eval run        # run it
```

`check` is why the file is worth having. A configuration can name a harness and a model,
but only a session proves the CLI is installed and signed in, that the MCP authorization
was completed, that the model id is one the CLI accepts, and that a tool call reaches the
knowledge base. It runs one live session that has to reach the knowledge base, and reports
the model the CLI actually resolved — an alias such as `opus` silently becomes a dated model
id, so pin an exact one and two runs stay comparable. `--no-probe` skips the live session;
`--provider` and `--model` check a harness before adopting it.

Three layers, each overriding the last: `config.json`, committed and the answer to what
this repository runs; `config.local.json`, gitignored, so choosing another harness locally
never lands in a commit; and flags, which are a one-off and never a new default. Switching
provider by flag drops the configured model with it, because a model id belongs to the CLI
that understands it.

`knowledgeTemplate` is an independent axis with two values: `default`, the product template,
and `greedy`, the eval-only ablation that asks the agent to remember as much as possible while
choosing its own organization. Use `--template` for a one-off override. The greedy template
lives under `eval/templates/` and is absent from production images.

An unknown or misspelled field is an error rather than a shrug, since a `batchs` that
silently kept the default would report one run and measure another.

### What to put in it

The committed default is one day of `amara-life-v1`, the corpus that matches what Context
Use actually does. It is a day rather than the corpus because a default should be cheap
enough to run on a whim and real enough that passing it means something.

In order of what is worth measuring: `amara-life-v1` first, then `steve-jobs-v1` and
LongMemEval, and `world-v1` last — it is the narrowest of the four and is here mainly
because it is the only corpus that arrived with an answer key of its own.

```jsonc
// The whole amara corpus, on a pinned Claude Code model.
{
  "harness": { "provider": "claude", "model": "claude-opus-5" },
  "knowledgeTemplate": "default",
  "eval": { "command": "distill", "corpus": "amara-life-v1" }
}

// The same selection with the greedy knowledge-maintenance ablation.
{ "knowledgeTemplate": "greedy" }

// Its eight busy days rather than all forty-seven, distilled and then asked and scored.
{ "eval": { "command": "qa", "corpus": "amara-life-v1", "window": "dense" } }

// One Steve Jobs story, three times, because one stochastic run is not a measurement.
{ "eval": { "command": "story", "story": "imac-design-and-launch", "repeat": 3 } }

// Every story, or the historical ones in chronological order.
{ "eval": { "command": "story", "story": "all" } }
{ "eval": { "command": "journey" } }

// LongMemEval: two cases of every question type, or the whole benchmark.
{ "eval": { "command": "longmem", "stratify": 2 } }
{ "eval": { "command": "longmem", "all": true } }

// LoCoMo: one conversation asked two questions per category, or all ten and all 1,986.
{ "eval": { "command": "locomo", "conversation": "conv-30", "stratify": 2 } }
{ "eval": { "command": "locomo", "all": true } }

// world-v1 seeded and asked, which measures retrieval alone.
{ "eval": { "command": "qa", "corpus": "world-v1" } }
```

`config.json` is JSON, not JSONC — the comments above are for this page only. A layer may
carry `harness`, `knowledgeTemplate`, or `eval` independently.

## What reaches the agent, and what does not

The agent's workspace sits inside this repository, so both CLIs will read this
repository's instructions to its own maintainers and hand them to the agent under test
unless told not to. Both were observed doing it, and each is stopped by a different flag:

| | reads local settings | reads project documents | receives the MCP server's `instructions` |
| --- | --- | --- | --- |
| Codex | not with `--ignore-user-config` | not with `-c project_doc_max_bytes=0` | **no — the CLI discards them** |
| Claude Code | not with `--setting-sources ""` | not with `--setting-sources ""` | yes |

`--ignore-user-config` drops `$CODEX_HOME/config.toml`, where a developer's own model,
reasoning effort, sandbox policy and extra MCP servers live. `--ignore-rules` drops user
and project execpolicy `.rules` files. Neither touches `AGENTS.md`, which Codex reads from
the working directory upward: this repository has no root `AGENTS.md` today, so those
sessions were clean by circumstance rather than by construction, and
`project_doc_max_bytes=0` is what actually holds it.

The MCP server's `instructions` — the one line Context Use sends every client at
initialize — are unaffected by any of the above, because they arrive over the wire rather
than off the disk. Claude Code carries them into context; Codex discards them, with or
without those flags. That is a difference between the two harnesses rather than something
this repository configures, and it is one more reason a Codex score and a Claude score are
not each other's baseline.

Corpus QA, story runs and LoCoMo's two deterministic metrics are scored without a model at
all — sealed keys compared by string, structural expectations, and ported token metrics.
The two harness judges, LongMemEval's and LoCoMo's optional one, are the only scorers that
are agent sessions, and both run with no MCP server and void their own judgement on any
tool action, so the isolation above is the whole of what they read.

## Layout

The layout follows gbrain-evals' `data`, `runner`, and `cli` boundaries while keeping each
local evaluation self-contained:

```text
eval/
├── config.json           the harness, model, knowledge template and evaluation a run uses
├── config.ts             how that configuration is read, layered and validated
├── data/
│   ├── amara-life-v1/    corpus, lockfile, loader, QA, and structural gold
│   ├── locomo-v1/        pinned external dataset manifest, case loader, and scorer fixture
│   ├── longmemeval-v1/   pinned external dataset manifest and isolated case loader
│   ├── world-v1/         corpus, lockfile, loader, QA derivation, and seeding
│   └── steve-jobs-v1/    interactive stories, expectations, journey, and sources
├── templates/            eval-only knowledge-template ablations
├── runner/               reusable corpus, distillation, QA, story, agent, and snapshot code
└── cli/                  command composition over the data packages and runner
```

Everything specific to one fixed input belongs under `data/<eval-id>/`. Code that can run
another corpus, question set, or interactive story belongs under `runner/`; `cli/`
composes those pieces into the existing `bun run eval` commands.

## Running LongMemEval QA

Start with one case or a small deterministic slice; running without a selector fails, and
the full 500-case suite requires an explicit `--all`:

```sh
bun run eval longmem:fetch
bun run eval longmem:list --limit 10
bun run eval longmem:run --case <question-id>
bun run eval longmem:run --limit 3
bun run eval longmem:score
# For published-score comparability, use the official pinned judge model:
OPENAI_API_KEY=... bun run eval longmem:score --judge-provider openai
```

The download is cached under `.eval-data/` and verified against its pinned size and SHA-256
on use. One selected row is one independent knowledge base: all of that row's sessions are
distilled before its one question is asked, then the next row resets the stack. The default
is at most ten sessions per distillation batch, with a 24 KB agent transport ceiling.
Results and transcripts land under `eval/results/longmemeval/`.
The default key-free harness judge uses the exact official prompt but a subscription model;
the score records that distinction. Only `--judge-provider openai` uses LongMemEval's exact
`gpt-4o-2024-08-06` judge model.

## Running LoCoMo QA

```sh
bun run eval locomo:fetch
bun run eval locomo:list
bun run eval locomo:run --conversation conv-30 --stratify 2
bun run eval locomo:run --limit 2
bun run eval locomo:score
bun run eval locomo:score --judge-provider codex
```

Two selectors, because the two costs are independent. One of `--conversation`, `--limit` or
`--all` picks the conversations to distill; `--questions <n>` or `--stratify <n>` narrows
which of each conversation's questions get asked. Narrowing the questions never narrows the
history — the whole conversation is always distilled — so a short run samples the same
measurement rather than a different one. All of it is expensive: `--all` is 10 distillation
suites and 1,986 QA sessions.

Scoring is deterministic and needs no key or session: it reports LoCoMo's official F1 and
A-mem's own F1 and BLEU side by side, because those are different functions and A-mem's
published numbers use the second. `--judge-provider` adds this repository's LLM judge as a
separately labelled third number. Results land under `eval/results/locomo/` and contain no
reference answers — scoring re-reads the pinned dataset.

The dataset is CC BY-NC 4.0 and is cached outside git rather than vendored.

## Running interactive stories

```sh
bun run eval story:list
bun run eval story:run --story imac-design-and-launch
bun run eval story:run --all --repeat 3
bun run eval journey:run
```

A story run resets the knowledge base once before the selected suite, then preserves it as
each story builds on the ones before it. Every story gets a fresh agent conversation, and
every repetition starts another clean suite. `journey:run` selects the historical stories
in chronological order; `story:run --all` uses the suite's declared story order. Reports
and per-turn snapshots, resolutions, tool activity, and scores land under
`eval/results/stories/`.

Every historical story starts a fresh agent conversation with the same minimal operational
instruction to use the Context Use MCP as Steve's second brain. Only the first gets the
suite introduction identifying him as Apple's co-founder, so later sessions must resolve
“we” from the accumulated knowledge base rather than conversation history. The single
`implicit-write-trigger` story suppresses both prompts and separately measures spontaneous
tool activation. The real default-template `AGENTS.md` guides remain the only
knowledge-organization instructions.

## Two corpora

Both are copied verbatim from [`garrytan/gbrain-evals`][upstream] and never edited — see
[data/UPSTREAM.md](data/UPSTREAM.md) for the pinned commits and how integrity is
enforced.

| | [`amara-life-v1`](data/amara-life-v1/README.md) | [`world-v1`](data/world-v1/README.md) |
| --- | --- | --- |
| What it is | raw activity: email, Slack, calendar, meetings, notes | 240 already-distilled biographical pages |
| Size | 418 items over 47 days | 240 pages over 10 batches |
| Measures | extraction, distillation and retrieval | prose reconciliation and retrieval |
| Knowledge base under test | built by `distill` | seeded by `qa:seed` |
| Answer key | entities and meetings ([gold](data/amara-life-v1/gold/README.md)), plus 99 authored questions ([QA](data/amara-life-v1/qa/)) | 145 derived questions ([QA](data/world-v1/qa/)) |
| Scored by | `gold:check` and `qa:score` | `qa:score` |

`amara-life-v1` is the corpus that matches what Context Use actually does. `world-v1` is
the easier and narrower one, and it is here because **it is the only corpus upstream ships
with an answer key of its own** — every `gold/*.json` file for `amara-life-v1` is still an
empty stub with a single `_example` row, and the question sets upstream does populate are
keyed to `world-v1` slugs.

Both of `amara-life-v1`'s keys are therefore this repository's: the entity list in
[gold](data/amara-life-v1/gold/README.md), and 99 authored questions in
[QA](data/amara-life-v1/qa/). Between them
they ask whether the right things were written down, and whether they can be got back out.

```sh
bun run eval corpus:verify --corpus world-v1     # working copy against corpus.lock.json
bun run eval corpus:refresh --corpus world-v1    # working copy against the pinned commit
```

Both are read-only. Re-pinning a corpus has to be a deliberate commit, because changing it
invalidates every result measured against the previous version.

## Running the distillation

```sh
bun run local up
bun run eval connect codex     # once: registers the MCP and completes its OAuth
bun run eval distill --corpus world-v1 --batches 2
```

`connect` takes `codex` or `claude`, and defaults to the configured harness. The browser it
opens asks for this stack's owner passkey.

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

Every run resets semantic knowledge and assets in this local instance to its configured
knowledge template while preserving the owner passkey and OAuth authorization. Do not keep
development data in it. Snapshots, per-batch agent logs, QA answers and scores,
structural scores, and Markdown reports stay together in a timestamped run directory
under `eval/results/corpus/`. Story suites use the parallel `eval/results/stories/`
directory, LongMemEval uses `eval/results/longmemeval/`, and LoCoMo
`eval/results/locomo/`. Their shared `eval/results/`
parent is gitignored so repeated local runs remain available without entering commits.

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

`CorpusRecordReader` in [runner/corpus/records.ts](runner/corpus/records.ts) implements the same
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
`runner/corpus/records.ts` is not in the image at all. `mcp-app.ts` reaches it through a
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
