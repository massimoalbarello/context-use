---
name: ship-change
description: Implement, add, change, refactor, or fix repository code through the complete engineering workflow ending in a reviewed pull request. Use whenever a user asks for a code change or bug fix; do not use for read-only analysis, explanation, review, planning, or when the user explicitly says not to implement or not to open a pull request.
---

# Ship a change

Carry the user's requested repository change from problem framing through a reviewed pull request.
The user's explicit instructions take precedence, including any request to stop before opening a pull
request.

## Frame the change

1. Read the root `AGENTS.md` and every narrower guide governing files the change may touch. Follow
   only the linked instruction branches relevant to the work.
2. Before editing, state the problem, desired outcome, constraints, and observable success
   condition. For a fix, distinguish the reported symptom from the root cause and reproduce the
   failure when practical.
3. Inspect the code that owns the behavior. Identify its boundaries, important invariants,
   established patterns, and the smallest coherent place to make the change.
4. For a non-trivial change, share a concise design note covering ownership, boundaries,
   invariants, plausible alternatives, and tradeoffs. Include doing nothing when it is meaningful.
   Pause only when a choice would materially alter the user's intent or scope.
5. Prefer the simplest design that addresses the concrete need and, for a fix, removes the root
   cause rather than masking a symptom.

## Implement and review

1. Work on a focused `codex/` branch unless the user supplied a branch or the current branch is
   already the correct one. Preserve unrelated work already present in the tree.
2. Follow the owning code's established patterns and keep the diff to one reviewer-statable
   outcome. Add or update tests at the lowest layer that proves the important invariant, boundary,
   or failure mode.
3. Review the complete diff after implementation against the request and every applicable
   engineering guideline. Check in particular:

   - the root cause and relevant failure modes;
   - whether deletion or consolidation would make the design simpler;
   - ownership, trust boundaries, durable-state safety, and sources of truth;
   - consistency with established patterns and public contracts;
   - test strength, redundancy, and missing regression coverage;
   - unrelated changes, generated churn, and accidental scope growth.

4. Resolve every actionable review finding and re-review the resulting diff. Proceed only when no
   known issue remains that would make the change unnecessarily complex, incorrect, unsafe, or
   incomplete.

## Validate in the real app

1. Run the applicable automated tests and checks required by the repository instructions and the
   changed packages.
2. Start `bun run dev:isolated:seeded` and exercise the affected behavior in the browser against
   the disposable seeded application. Use `bun run dev:isolated:seeded --all` when the journey
   needs fixtures outside the default seed set or the full graph's breadth or volume. Successful
   startup alone is not validation; test the changed journey and its important failure or boundary
   states. Stop the isolated process when validation is complete.
3. For a user-visible frontend change, capture clear screenshots of the implemented result after
   browser validation. Include multiple states or viewports when they help the reviewer, and prefer
   a short recording when motion or a multi-step interaction is the behavior under review. Do not
   commit visual evidence unless the repository or user requires it.
4. Fix failures caused by the change and rerun the relevant validation. Do not open the pull
   request while a material validation gap prevents confidence in the result.

## Open the pull request and hand off

1. Commit the focused change with a repository-compatible Conventional Commit message.
2. Read and follow [`open-pull-request`](../open-pull-request/SKILL.md) to push the branch, open a
   pull request with an explicit base, and verify the created pull request.
3. In the final response, include:

   - the pull request title and link;
   - the exact branch name so the user can check it out locally;
   - the pull request description exactly as submitted, so it can be reviewed in chat;
   - a concise implementation and validation summary;
   - inline screenshots and playable recordings for user-visible frontend changes;
   - only material risks, validation gaps, or required reviewer actions.
