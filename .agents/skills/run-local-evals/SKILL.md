---
name: run-local-evals
description: Run and interpret Context Use's local corpus distillation, QA, Steve Jobs story, LongMemEval, and LoCoMo evals. Use when asked to run, score, inspect, or compare any local eval, including one question, story, case, repeated suite, or full eval family.
---

# Run Local Evals

## Work only from the main worktree

Resolve the main Git worktree before reading runbooks or running any eval command. The first
`worktree` record is the main worktree:

```sh
git worktree list --porcelain
```

Change to that exact path and verify it:

```sh
eval_main_worktree="$(git worktree list --porcelain | sed -n '1s/^worktree //p')"
cd "$eval_main_worktree"
test "$(git rev-parse --show-toplevel)" = "$eval_main_worktree"
```

Stop if the path is empty or the assertion fails. Use the resolved main-worktree path as the
working directory for every later shell command; do not rely on the agent's initial working
directory. Keep downloaded datasets under its `.eval-data/` tree and generated results under
its `eval/results/` tree. Never run an eval in a linked worktree, redirect output there, or
copy datasets or results into one.

If the code to test exists only in a linked worktree, report that it must first be made
available in the main worktree. Do not copy, commit, or merge it there without authorization.

## Protect the shared stack

Run exactly one eval process at a time across all agents, terminals, providers, and
worktrees. Never background or parallelize eval commands. Let `--repeat` perform repetitions
serially.

From the main worktree, record the source state and confirm the singleton is available:

```sh
git status --short --branch
git rev-parse HEAD
ps aux | rg '[b]un run eval|[s]cripts/eval\.ts'
bun run local status
```

Run these checks from an execution context that can inspect host processes, the Docker
socket, and `localhost`. If a sandbox reports `operation not permitted`, hides the Docker
socket, or cannot reach the local stack, do not infer that the singleton is free or the
stack is stopped. Obtain the required host access and repeat the checks.

If another eval is active, wait for it. If the stack is stopped, start its existing volumes:

```sh
bun run local up
```

Never reset while another eval is running. Never use `local down`, `local destroy`,
`local purge`, Docker volume removal, or Docker cleanup commands. Do not keep unrelated
development data in the stack because eval resets erase knowledge and assets while retaining
the owner passkey and provider authorization.

## Read the runbooks

From the main worktree:

1. Read `eval/README.md` for the shared configuration and command interface.
2. Read the guide for the requested eval:
   - `world-v1`: `eval/data/world-v1/README.md`
   - `amara-life-v1`: `eval/data/amara-life-v1/README.md`
   - Steve Jobs stories or journey: `eval/data/steve-jobs-v1/README.md`
   - LongMemEval: `eval/data/longmemeval-v1/README.md`
   - LoCoMo: `eval/data/locomo-v1/README.md`
3. Read more than one family guide only when the request spans those families.
4. Follow the commands in those READMEs without recreating another workflow here.

## Prove the provider path before starting

Before any state-preparing command, run the full live check with the same provider, model,
and knowledge template intended for the measurement:

```sh
bun run eval check --provider <codex|claude> --model <id> --template <default|greedy>
```

Omit `--model` only when the measurement intentionally uses the CLI default. Do not use
`--no-probe` as the final readiness gate: it checks configuration, binaries, sign-in, and
the stack, but it does not open an agent session or prove that the MCP can read the
knowledge base. A run may otherwise spend every built-in retry on an unauthorized MCP and
still exit after producing only an incomplete report.

Do not start the eval until the live check exits successfully and reports `Ready`, a
successful knowledge-base read, and, for Claude, `context_use_eval connected`. Record the
resolved Claude model reported by `Model in use`; a CLI default or alias is not a comparable
model identifier by itself.

Provider CLI sign-in and MCP authorization are separate requirements. If the live check
reports that `context_use_eval` needs authorization:

- For Claude, keep the local stack running and run `bun run eval connect claude` in an
  interactive PTY. The OAuth flow may open a browser, asks for this stack owner's passkey
  when no authorized browser session exists, and may print a URL to open manually. If it
  says that stdin is not a terminal, rerun the same command with a PTY; do not start the
  eval.
- For Codex, run `bun run eval connect codex` and complete its OAuth flow.
- After either connection succeeds, rerun the full live `eval check` above. Connection
  command success alone is not the readiness gate.

State resets are designed to preserve the owner passkey and provider OAuth, but that does
not prove the provider has a valid stored token before the first run. Always perform this
preflight for the requested provider and measurement settings.

## Preserve eval integrity

- Let state-preparing commands perform their own resets. Never reset manually before them.
- Never reset between `qa:seed` or `distill` and its matching `qa:ask`.
- Do not run `corpus:refresh`, `qa:derive --write`, or `gold:profile --write` unless the user
  explicitly asks to update committed fixtures.
- If a README conflicts with the CLI or repository state, stop before changing eval state
  and report the mismatch. Update the authoritative README when the workflow changes.
- Do not write an eval result into the knowledge base under test.
- A zero exit code from a state-preparing runner is not by itself a valid measurement.
  Read its final coverage summary and require every selected source record or conversation
  session to have been consumed and every intended question to have been answered.
- If MCP authorization or another failure leaves zero or partial evidence coverage, let the
  runner write its incomplete report, mark that run incomplete or void, and do not score or
  compare it. Fix the provider path, pass the full live check, and start a fresh
  state-preparing run; do not reuse the invalid knowledge state unless the family runbook
  explicitly documents a resume workflow.

Report the absolute main-worktree and result paths, commit SHA and dirty state, knowledge
template, provider and model, exact command, run ID, selection flags, scores, incomplete or
void cases, and notable failure patterns. Compare runs only when the corpus, knowledge
template, provider, model, selection, batching, repeat count, and source revision match.
Treat one stochastic run as a baseline, not proof of a regression or improvement.
