# LongMemEval v1

This package adapts LongMemEval into an end-to-end Context Use QA evaluation:

```text
one complete history -> activity distillation -> iterative knowledge search -> answer -> official QA judge
```

The headline is **end-to-end QA accuracy**. Retrieval recall and precision are not scored:
the answering agent can search the knowledge base iteratively, just as it does in normal
use.

## Dataset and cache

The 277 MB cleaned small benchmark is too large to vendor. `manifest.ts` instead pins all
three facts needed to reproduce it: the Hugging Face repository and immutable revision,
the byte length, and the SHA-256 digest. The first command that needs it downloads it to:

```text
.eval-data/longmemeval/<revision>/longmemeval_s_cleaned.json
```

That directory is ignored by git and Docker. Every use verifies the cached bytes; an
interrupted or mismatched download is discarded. Fetch or check it explicitly with:

```sh
bun run eval longmem:fetch
bun run eval longmem:verify
bun run eval longmem:list --limit 10
```

`--dataset-path <path>` can point at an existing copy, but it must have the same pinned
size and digest. It does not create an unpinned benchmark variant.

## Isolation and gold sealing

A top-level LongMemEval row is atomic: it contains one complete, ordered conversation
history and one question. All sessions in that row are distilled into the same knowledge
base. The knowledge base is reset only when the runner moves to the next top-level row,
whose history and question are independent by benchmark definition.

Before distillation, the runner writes a temporary `longmemeval-case.json` containing only
session dates and user/assistant turns. It removes `has_answer` and all other upstream turn
labels. The question, reference answer, answer-session IDs, and question type never enter
the agent-facing source. The QA agent is started only after every session has been served,
in a fresh conversation with access to the Context Use MCP only.

## Small runs first

There is deliberately no implicit whole-suite run. Choose exactly one selector:

```sh
# One named case (the best smoke test)
bun run eval longmem:run --case <question-id>

# The first few dataset rows
bun run eval longmem:run --limit 3

# N rows from each of the six question types
bun run eval longmem:run --stratify 1

# All 500 rows; explicit because this is expensive
bun run eval longmem:run --all
```

Even one cleaned-small case commonly contains roughly 40–55 long conversation sessions,
so `--case` is a bounded benchmark run, not a quick unit test. Use `longmem:verify`,
`longmem:list`, and the automated tests while developing the harness; an interrupted
partial-history QA probe is diagnostic only and must not be reported as official accuracy.

By default, at most ten conversation sessions form one activity-distillation batch.
`--sessions-per-batch` exists for experiments, but changing it changes the agent's working
unit and should be recorded when comparing results. Each command is one trial; the runner
does not repeat cases automatically.

Conversation records are much larger than ordinary email or calendar records. Inside a
batch, the materializer also closes a batch at a 24 KB agent-facing transport boundary.
The shared `SourceRecordReader` enforces the same ceiling. Sessions remain atomic; the cap
changes transport batching, not the history or reset boundary. This lets the existing
one-agent-per-batch runner keep each model working set bounded. Eval-corpus checkpoints use
a compact checksummed token; after the agent successfully replaces the state page, the
harness makes that machine token byte-exact before the next agent session. A transient or
incomplete session gets at most three attempts on the same batch, and the report records the
attempt count. The ordinary local corpus evals retain their one-attempt behavior.

Run artifacts land under `eval/results/longmemeval/`, including the public source copy,
distillation snapshots, agent transcripts, per-case results, an official-format
`hypotheses.jsonl`, and the run report. Score the latest or a named run with LongMemEval's
published question-type prompts and pinned `gpt-4o-2024-08-06` judge:

```sh
OPENAI_API_KEY=... bun run eval longmem:score
OPENAI_API_KEY=... bun run eval longmem:score <run-id>
```

The judge is a TypeScript port of LongMemEval's `evaluate_qa.py`, pinned to the upstream
commit recorded in `manifest.ts`. A case the harness marks void remains visible and counts
as an end-to-end failure; judge-only accuracy is also reported so infrastructure failures
cannot silently inflate the headline.

## Attribution

LongMemEval and the cleaned dataset are MIT licensed. The benchmark code is published by
[Snap Research](https://github.com/snap-research/longmemeval); this pin downloads the
[cleaned dataset](https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned) used by
the benchmark ecosystem.
