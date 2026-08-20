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

Report the absolute main-worktree path and absolute result path with every run.

If the code to test exists only in a linked worktree, report that it must first be made
available in the main worktree. Do not copy, commit, or merge it there without authorization.

## Read the runbooks

From the main worktree:

1. Read `eval/README.md` for shared stack, configuration, state, and reporting rules.
2. Read the guide for the requested eval:
   - `world-v1`: `eval/data/world-v1/README.md`
   - `amara-life-v1`: `eval/data/amara-life-v1/README.md`
   - Steve Jobs stories or journey: `eval/data/steve-jobs-v1/README.md`
   - LongMemEval: `eval/data/longmemeval-v1/README.md`
   - LoCoMo: `eval/data/locomo-v1/README.md`
3. Read more than one family guide only when the request spans those families.
4. Follow the commands and constraints in those READMEs without recreating a parallel
   workflow from this skill.

If a README conflicts with the CLI or repository state, stop before changing eval state and
report the mismatch. Fix the authoritative README when the workflow itself changes; do not
add duplicate operational instructions to this skill.
