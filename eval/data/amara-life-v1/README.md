# amara-life-v1

This eval distills raw email, Slack, calendar, meeting, and note activity, then measures the
knowledge structure and question-answering retrieval built from it.

Follow the [shared eval runbook](../../README.md) first.

## Run the dense-window eval

```sh
bun run eval corpus:verify --corpus amara-life-v1
bun run eval qa:verify
bun run eval gold:profile
bun run eval distill --corpus amara-life-v1 --window dense --batches 8
```

Copy the run ID printed by `distill`. Inspect the structural score, then ask and score the
questions without resetting the stack:

```sh
bun run eval gold:check <run-id>
bun run eval qa:ask <run-id>
bun run eval qa:score <run-id>
```

## Change the scope

Use the full 47-day corpus:

```sh
bun run eval distill --corpus amara-life-v1 --window full --batches 47
```

Use `--batches <n>` for a shorter run. A batch is one corpus day. The QA runner normally
asks only questions whose evidence was included in the completed batches; use `--only
<question-id>` or `--limit <n>` to narrow that set further.

Results are written to `eval/results/corpus/<run-id>/`. Start with `report.md`,
`gold-score.json`, and `qa-score.json`.
