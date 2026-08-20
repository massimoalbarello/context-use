# Local evals

This is the shared runbook for every local eval. Read it first, then follow the guide for
the eval you want to run:

| Eval | Measures | Run guide |
| --- | --- | --- |
| `world-v1` | retrieval from an already-built knowledge base | [`data/world-v1/README.md`](data/world-v1/README.md) |
| `amara-life-v1` | distillation, structure, and retrieval | [`data/amara-life-v1/README.md`](data/amara-life-v1/README.md) |
| `steve-jobs-v1` | knowledge writes across interactive stories | [`data/steve-jobs-v1/README.md`](data/steve-jobs-v1/README.md) |
| LongMemEval | end-to-end conversational-memory QA | [`data/longmemeval-v1/README.md`](data/longmemeval-v1/README.md) |
| LoCoMo | end-to-end conversational-memory QA | [`data/locomo-v1/README.md`](data/locomo-v1/README.md) |

## Always use the main worktree

Run the complete workflow from the main Git worktree so downloaded datasets and generated
results have one durable home. The first record printed below is the main worktree:

```sh
git worktree list --porcelain
```

Change to that path and verify it before continuing:

```sh
eval_main_worktree="$(git worktree list --porcelain | sed -n '1s/^worktree //p')"
cd "$eval_main_worktree"
test "$(git rev-parse --show-toplevel)" = "$eval_main_worktree"
```

Stop if the path is empty or the assertion fails. Never run an eval in a linked worktree,
redirect its output there, or copy datasets or results back into one. If the code to test
exists only in a linked worktree, make it available in the main worktree before running;
do not copy, commit, or merge it there without authorization.

## Preflight

Only one eval process may use the shared `context-use-dev` stack at a time. Do not run evals
in parallel or in the background.

```sh
git status --short --branch
git rev-parse HEAD
ps aux | rg '[b]un run eval|[s]cripts/eval\.ts'
bun run local status
```

If another eval is active, wait for it. If the stack is stopped, start the existing stack
and volumes:

```sh
bun run local up
```

Never use `local down`, `local destroy`, `local purge`, Docker volume removal, or Docker
cleanup commands for an eval. State-preparing commands reset eval knowledge and assets
while preserving the owner passkey and provider authorization. Do not keep unrelated
development data in this stack because an eval reset will erase it.

## Choose the configuration

[`config.json`](config.json) contains the committed provider, model, knowledge template, and
default eval. Gitignored `config.local.json` overrides it locally, and command flags override
the configuration for one run. Do not edit `config.json` for a one-off run.

`knowledgeTemplate` is independent of the harness and eval selection:

- `default` uses the production knowledge template.
- `greedy` uses the eval-only ablation that asks the agent to remember as much as possible
  while choosing its own organization.

Use `--template <default|greedy>` to override it for `check` or a state-preparing command.
The greedy template lives under `eval/templates/` and is not included in production images.

Check the configured setup before spending a run on it:

```sh
bun run eval check
```

Use `--no-probe` to skip the live session. Use `--provider`, `--model`, and `--template` to
check one-off settings. If the selected provider is not authorized, connect only that
provider:

```sh
bun run eval connect codex
```

Use `claude` instead of `codex` when needed. The browser flow requires the stack owner's
passkey.

To run exactly the eval selected by the configuration:

```sh
bun run eval run
```

For a specific eval or selection, use its linked run guide above. Let `--repeat` perform
its repetitions serially; never start separate repetitions concurrently.

## Preserve state between dependent commands

`qa:seed`, `distill`, `story:run`, `journey:run`, `longmem:run`, and `locomo:run` prepare
their own state and reset to the selected knowledge template at the correct boundary. Do
not reset manually before them.

`qa:ask`, `qa:score`, `gold:check`, `longmem:score`, `locomo:score`, and `locomo:view`
depend on an existing run. Pass the run ID printed by the preparing command. Never reset
between `qa:seed` or `distill` and its matching `qa:ask`.

Fixture-writing commands change the benchmark and are not part of running an eval. Do not
use `corpus:refresh`, `qa:derive --write`, or `gold:profile --write` unless the user asked to
update committed fixtures.

## Results

All generated files are gitignored and remain in the main worktree:

| Eval | Results directory |
| --- | --- |
| `world-v1`, `amara-life-v1` | `eval/results/corpus/` |
| `steve-jobs-v1` | `eval/results/stories/` |
| LongMemEval | `eval/results/longmemeval/` |
| LoCoMo | `eval/results/locomo/` |

Downloaded LongMemEval and LoCoMo datasets live under `.eval-data/` in the main worktree.

Report the main-worktree path, commit SHA and dirty state, knowledge template, provider and
model, exact command, run ID, selection flags, absolute result path, scores, incomplete or
void cases, and notable failure patterns. Compare runs only when the corpus, knowledge
template, provider, model, selection, batching, repeat count, and source revision match.
Treat one stochastic run as a baseline, not proof of a regression or improvement.
