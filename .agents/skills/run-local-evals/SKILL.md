---
name: run-local-evals
description: Run and interpret Context Use's local corpus distillation, QA, Steve Jobs story, LongMemEval, and LoCoMo evals. Use when asked to run, score, inspect, or compare any local eval, including one question, story, case, repeated suite, or full eval family.
---

# Run Local Evals

Use the repository READMEs as the operational source of truth. Do not run an eval command
until you have read the shared runbook and the relevant family guide.

1. Read `<main-worktree>/eval/README.md` for the canonical worktree, shared stack,
   configuration, preflight, state, and reporting rules.
2. Read the guide for the requested eval:
   - `world-v1`: `<main-worktree>/eval/data/world-v1/README.md`
   - `amara-life-v1`: `<main-worktree>/eval/data/amara-life-v1/README.md`
   - Steve Jobs stories or journey: `<main-worktree>/eval/data/steve-jobs-v1/README.md`
   - LongMemEval: `<main-worktree>/eval/data/longmemeval-v1/README.md`
   - LoCoMo: `<main-worktree>/eval/data/locomo-v1/README.md`
3. Read more than one family guide only when the request spans those families.
4. Follow the commands and constraints in those READMEs without recreating a parallel
   workflow from this skill.

If a README conflicts with the CLI or repository state, stop before changing eval state and
report the mismatch. Fix the authoritative README when the workflow itself changes; do not
add duplicate operational instructions to this skill.
