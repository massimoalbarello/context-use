# LoCoMo v1

This eval distills a complete conversation, asks every question against that knowledge
base, and reports an LLM-judge score.

Follow the [shared eval runbook](../../README.md) first.

## Prepare the dataset

The pinned CC BY-NC 4.0 dataset is downloaded to `.eval-data/locomo/` in the main worktree.

```sh
bun run eval locomo:fetch
bun run eval locomo:verify
bun run eval locomo:list
```

## Run conversations

Choose exactly one conversation selector: `--conversation`, `--limit`, or `--all`.

```sh
# One conversation and all of its questions
bun run eval locomo:run --conversation conv-30

# First two conversations, every question
bun run eval locomo:run --limit 2

# All ten conversations and all 1,986 questions
bun run eval locomo:run --all
```

The runner always distills the complete selected conversation before asking every question.
A full run is about 2,030 agent sessions, so confirm the intended selection before starting.

## Score and inspect a run

Copy the run ID printed by `locomo:run`. Scoring defaults to the Codex subscription judge:

```sh
bun run eval locomo:score <run-id>
```

Select another judge explicitly when needed:

```sh
OPENAI_API_KEY=... bun run eval locomo:score <run-id> --judge-provider openai
```

Render the answers and scores locally:

```sh
bun run eval locomo:view <run-id> --out <path.html>
```

Results are written to `eval/results/locomo/<run-id>/`. They do not contain reference
answers; scoring and viewing read those from the pinned dataset.
