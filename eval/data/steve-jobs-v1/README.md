# steve-jobs-v1

This eval measures knowledge writes across short, dated conversations about Steve Jobs's
second period at Apple.

Follow the [shared eval runbook](../../README.md) first.

## Run one story

List the available IDs, then run one:

```sh
bun run eval story:list
bun run eval story:run --story imac-design-and-launch
```

Replace `imac-design-and-launch` with the selected story ID. Add `--repeat <n>` for serial
repetitions.

## Run a suite

Run every registered story in suite order:

```sh
bun run eval story:run --all
```

Run the historical stories in chronological journey order:

```sh
bun run eval journey:run
```

Both modes reset once before the suite, preserve knowledge between stories, and start a
fresh provider conversation for each story. Each repetition begins with another reset.
`story:run --all` and `journey:run` overlap, so run both only when both modes are required.

Results are written to `eval/results/stories/<run-id>/`. Start with `report.md`.
