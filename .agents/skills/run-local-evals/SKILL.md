---
name: run-local-evals
description: Run and interpret Context Use's local corpus distillation, QA, Steve Jobs story, and journey evals while preserving Docker passkeys and MCP OAuth. Use when asked to run one eval, one story or QA question, a repeated suite, or every local eval family, especially when agents, terminals, or worktrees share the context-use-dev Docker stack.
---

# Run Local Evals

Run evals from the repository root. Treat the local Docker stack as a singleton, stateful test fixture: every eval process targets the same `context-use-dev` Compose project, PostgreSQL data, asset data, and MCP endpoint at `http://localhost:5173/mcp`.

## Protect the shared stack

Follow these invariants:

- Run exactly one eval process at a time across all agents, terminals, providers, and worktrees. Never background or parallelize eval commands.
- Let a command with `--repeat` perform its own repetitions; the runner executes them serially.
- Never reset while another eval process is running. If a run was interrupted, first establish that its process has exited.
- Keep the stack and its volumes. Never run `bun run local down`, `bun run local destroy`, `bun run local purge`, `docker compose down --volumes`, `docker volume rm`, a Docker prune command, or broad Docker cleanup.
- Use only `bun run local reset` to clean knowledge and assets for a new eval. This reset preserves passkeys and MCP OAuth authorization.
- Prefer the eval runner's automatic reset over a manual reset. `distill`, `qa:seed`, `story:run`, and `journey:run` already reset at the correct boundary.
- Never reset between preparation and live QA. `qa:ask` queries the knowledge base left by its matching `qa:seed` or `distill` run.
- Do not keep unrelated development data in this stack. Eval resets intentionally erase ordinary knowledge and assets, although they retain auth.

## Preflight every run

Record the source revision and confirm that no eval is already active:

```sh
git status --short --branch
git rev-parse HEAD
```

```sh
ps aux | rg '[b]un run eval|[s]cripts/eval\.ts'
```

No matching process means the singleton is available. If another eval is present, wait for it or report the conflict; do not start another one and do not reset underneath it.

Check the shared stack without changing it:

```sh
bun run local status
```

If the stack is stopped, start the existing stack and volumes:

```sh
bun run local up
```

Confirm the harness before spending a run on it. `check` prints the configured harness, model and eval, then proves each part of the path, ending with one live session that must reach the knowledge base:

```sh
bun run eval check
```

Add `--no-probe` to skip the live session, and `--provider`/`--model` to check a harness other than the configured one.

Do not reconnect a provider when authorization already works. If `check` or the runner reports missing provider authorization, connect only that provider and complete its interactive flow, which needs a browser and this stack's owner passkey:

```sh
bun run eval connect codex
```

Use `claude` instead of `codex` only when that is the requested provider.

## Know what the configuration decides

`eval/config.json` names the harness, the model and the eval, and every command takes its defaults from it. `bun run eval run` runs exactly what it names; the individual commands below still accept `--provider`, `--model`, `--corpus`, `--window`, `--batches` and `--repeat` for a one-off. Never edit `eval/config.json` to serve a single request — pass flags, or write the gitignored `eval/config.local.json` when the user wants a lasting local default. Report the harness and model with every result, because a score is comparable only to another score from the same pair.

## Know which commands own state

State-preparing commands reset automatically before writing their fixture:

- `qa:seed` prepares `world-v1` for retrieval-only QA.
- `distill --corpus amara-life-v1` builds the Amara knowledge base for gold and QA scoring.
- `story:run` prepares and runs selected Steve Jobs stories.
- `journey:run` prepares and runs the chronological Steve Jobs journey.

Dependent commands do not prepare a new live base:

- `qa:ask` must run while its seed or distillation base is still loaded.
- `qa:score` scores recorded QA answers offline.
- `gold:check` scores recorded Amara snapshots offline.

Read-only fixture checks such as `corpus:verify`, `qa:verify`, `qa:derive` without `--write`, and `gold:profile` without `--write` do not reset the stack. Never use `corpus:refresh`, `qa:derive --write`, or `gold:profile --write` unless the user explicitly asked to update committed eval fixtures.

## Run a single eval

### One Steve Jobs story

List valid story IDs, then run the selected story:

```sh
bun run eval story:list
```

```sh
bun run eval story:run --story imac-design-and-launch
```

The harness comes from `eval/config.json`; pass `--provider` or `--model` only when the user asks for a different one. Add `--repeat <n>` for serial repetitions of the same selection.

### The full Steve Jobs story suite

```sh
bun run eval story:run --all
```

This includes the implicit-write trigger and all historical stories. Use the journey command instead when the user wants only the historical stories in chronological journey form:

```sh
bun run eval journey:run
```

The full story suite and journey overlap; do not run both unless the user explicitly wants both harness modes.

### One world-v1 QA question

Prepare the retrieval-only base, copy the printed run ID, ask the one question while that base is still live, then score it:

```sh
bun run eval qa:seed
```

```sh
bun run eval qa:ask <world-run-id> --only <question-id>
```

```sh
bun run eval qa:score <world-run-id>
```

Use `--batches <n>` on `qa:seed` only when the selected question is due within those batches. Do not use `qa:ask --all` merely to force a question whose evidence was never served.

### One Amara QA question or a short distillation

Prepare the Amara base, copy the printed run ID, inspect its gold score, ask while that base is still live, then score:

```sh
bun run eval distill --corpus amara-life-v1
```

```sh
bun run eval gold:check <amara-run-id>
```

```sh
bun run eval qa:ask <amara-run-id> --only <question-id>
```

```sh
bun run eval qa:score <amara-run-id>
```

For a deliberately short distillation, add `--batches 1` or another requested count. Ask only questions due in the processed batches.

## Run every eval family sequentially

Use this order for a canonical local sweep. Complete every dependent step before starting the next state-preparing command.

First, validate committed fixtures without changing them:

```sh
bun run eval corpus:verify --corpus world-v1
bun run eval corpus:verify --corpus amara-life-v1
bun run eval qa:derive
bun run eval qa:verify
bun run eval gold:profile
```

Next, run the complete `world-v1` retrieval pipeline:

```sh
bun run eval qa:seed
bun run eval qa:ask <world-run-id>
bun run eval qa:score <world-run-id>
```

Then run the complete Amara distillation and retrieval pipeline:

```sh
bun run eval distill --corpus amara-life-v1
bun run eval gold:check <amara-run-id>
bun run eval qa:ask <amara-run-id>
bun run eval qa:score <amara-run-id>
```

Finally, run every Steve Jobs story:

```sh
bun run eval story:run --all
```

Run each displayed command only after the previous command exits. Replace each placeholder with the run ID printed by its preparation command. If the user also wants journey semantics, run `bun run eval journey:run` only after the story suite finishes.

## Read and retain results

Corpus and QA artifacts live under `eval/results/corpus/<run-id>/`. Inspect `report.md`, `report.json`, `gold-score.json` when present, and `qa-score.json` when present. Story artifacts live under `eval/results/stories/<run-id>/`; start with `report.md`.

Report at least:

- exact commit SHA and whether the worktree was dirty;
- harness provider and model, command, run ID, batch/window/repeat configuration, and result path;
- overall and per-case scores;
- unread or unreached records, voided questions, and other harness caveats;
- concentrated failure modes rather than only the headline score.

A single stochastic run is a baseline, not proof of a regression or improvement. Compare repeated runs only when their corpus, harness provider and model, batch/window, repeat count, and harness revision match.

Do not write an eval result into the local knowledge base under test: it contaminates subsequent inspection and disappears at the next reset. Keep the generated gitignored report as the local record of the run.
