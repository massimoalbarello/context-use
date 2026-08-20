# LoCoMo v1

This eval distills a complete conversation, asks selected questions against that knowledge
base, and reports LoCoMo and A-mem metrics with an optional LLM judge.

Follow the [shared eval runbook](../../README.md) first.

## Prepare the dataset

The pinned CC BY-NC 4.0 dataset is downloaded to `.eval-data/locomo/` in the main worktree.

```sh
bun run eval locomo:fetch
bun run eval locomo:verify
bun run eval locomo:list
```

## Run conversations

Choose exactly one conversation selector: `--conversation`, `--limit`, or `--all`. Optionally
narrow the questions with either `--questions` or `--stratify`.

```sh
# Cheapest representative smoke test: one conversation, two questions per category
bun run eval locomo:run --conversation conv-30 --stratify 2

# First two conversations, every question
bun run eval locomo:run --limit 2

# Every conversation, first twenty questions from each
bun run eval locomo:run --all --questions 20

# All ten conversations and all 1,986 questions
bun run eval locomo:run --all
```

Question selectors do not shorten the conversation history: the runner always distills the
complete selected conversation before asking questions. A full run is about 2,030 agent
sessions, so confirm the intended selection before starting.

## Score and inspect a run

Copy the run ID printed by `locomo:run`. Deterministic scoring needs no model or API key:

```sh
bun run eval locomo:score <run-id>
```

Add an optional judge:

```sh
bun run eval locomo:score <run-id> --judge-provider codex
OPENAI_API_KEY=... bun run eval locomo:score <run-id> --judge-provider openai
```

Render the answers and scores locally:

```sh
bun run eval locomo:view <run-id> --out <path.html>
```

Results are written to `eval/results/locomo/<run-id>/`. They do not contain reference
answers; scoring and viewing read those from the pinned dataset.
