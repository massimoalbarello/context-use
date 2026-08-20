# Local evals

This is the shared runbook for every local eval. Read it before the relevant eval-family
guide.

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

For a specific eval or selection, use its family guide. Let `--repeat` perform its
repetitions serially; never start separate repetitions concurrently.

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

Generated results are gitignored. The family guide names the exact result directory.

Report the commit SHA and dirty state, knowledge template, provider and model, exact command,
run ID, selection flags, scores, incomplete or void cases, and notable failure patterns.
Compare runs only when the corpus, knowledge template, provider, model, selection, batching,
repeat count, and source revision match. Treat one stochastic run as a baseline, not proof
of a regression or improvement.
