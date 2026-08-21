# Local evals

## Configuration

[`config.json`](config.json) contains the committed provider, model, knowledge template, and
default eval. Gitignored `config.local.json` overrides it locally, and command flags override
the configuration for one run.

`knowledgeTemplate` is independent of the harness and eval selection:

- `default` uses the production knowledge template.
- `greedy` uses the eval-only ablation that asks the agent to remember as much as possible
  while choosing its own organization.

`--template <default|greedy>` overrides it for `check` and state-preparing commands. The
greedy template lives under `eval/templates/` and is not included in production images.

## Commands

Check the configured harness, template, and eval:

```sh
bun run eval check
```

`--no-probe` skips the live session. `--provider`, `--model`, and `--template` check one-off
settings.

Connect a provider when authorization is missing:

```sh
bun run eval connect codex
```

Use `claude` instead of `codex` when needed. The browser flow requires the stack owner's
passkey.

Run exactly the configured eval:

```sh
bun run eval run
```

The relevant eval-family README contains commands for specific selections.

## Command state

`qa:seed`, `distill`, `story:run`, `journey:run`, `longmem:run`, and `locomo:run` prepare
their own state and reset to the selected knowledge template at the correct boundary.

`qa:ask`, `qa:score`, `gold:check`, `longmem:score`, `locomo:score`, and `locomo:view` use
an existing run. They accept the run ID printed by the preparing command.

Generated results are gitignored. The eval-family README names the result directory.

## Conversation working sets

Conversation corpora use the same planner as production. Ordinary source records remain intact;
an oversized conversation is divided at dialogue-turn boundaries, and every later excerpt starts
with a small, labelled overlap from the preceding excerpt. The eval runner maps each planned
working set to a fresh agent session, so the agent sees only one transport unit per run.
