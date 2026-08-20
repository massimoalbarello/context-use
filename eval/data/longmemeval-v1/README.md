# LongMemEval v1

This eval distills one complete conversation history, asks its single question against the
resulting knowledge base, and scores the answer with LongMemEval's judge rubric.

Follow the [shared eval runbook](../../README.md) first.

## Prepare the dataset

The pinned dataset is downloaded to `.eval-data/longmemeval/` in the main worktree.

```sh
bun run eval longmem:fetch
bun run eval longmem:verify
bun run eval longmem:list --limit 10
```

## Run cases

Choose exactly one selector:

```sh
# One case by ID
bun run eval longmem:run --case <case-id>

# The first n cases in dataset order
bun run eval longmem:run --limit <n>

# n cases from each of the six question types
bun run eval longmem:run --stratify <n>

# All 500 cases
bun run eval longmem:run --all
```

Prefer `--case` for a smoke test. `--limit` samples the dataset head, which contains one
question type. `--stratify 1` is the smallest selection spanning all six types.

Conversation records use the production planner: ordinary sessions remain intact, while an
oversized session is divided at dialogue-turn boundaries into overlapping fresh-session working
sets. A transient or incomplete session gets at most three attempts on the same working set.

One case commonly takes five to nine hours because its entire history is distilled before
the question is asked. Confirm the intended selection and time budget before starting.

## Score a run

Copy the run ID printed by `longmem:run`:

```sh
bun run eval longmem:score <run-id> --judge-provider codex
```

Use `claude` for the subscription-backed Claude judge. For strict comparison with the
published benchmark, use its pinned OpenAI judge model:

```sh
OPENAI_API_KEY=... bun run eval longmem:score <run-id> --judge-provider openai
```

Record the judge provider with every score. Only the OpenAI judge matches the published
evaluator's model. Results are written to `eval/results/longmemeval/<run-id>/`.
