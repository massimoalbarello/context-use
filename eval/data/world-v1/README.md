# world-v1

This eval measures retrieval from 240 already-distilled pages. It seeds those pages directly
instead of running the activity distiller.

Follow the [shared eval runbook](../../README.md) first.

## Run the full eval

```sh
bun run eval corpus:verify --corpus world-v1
bun run eval qa:derive
bun run eval qa:seed --batches 10
```

Copy the run ID printed by `qa:seed`, then ask and score that run:

```sh
bun run eval qa:ask <run-id>
bun run eval qa:score <run-id>
```

## Run a smaller selection

Seed only the first batches, then ask one due question or a limited set:

```sh
bun run eval qa:seed --batches 2
bun run eval qa:ask <run-id> --only <question-id>
bun run eval qa:score <run-id>
```

Use `--limit <n>` instead of `--only` to ask several questions. The runner normally asks
only questions whose evidence was included in the seeded batches. Do not use `--all` to
force questions whose evidence was not seeded.

Results are written to `eval/results/corpus/<run-id>/`.
