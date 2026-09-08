---
name: ship-change
description: Implement, add, change, refactor, or fix repository code through the complete engineering workflow ending in a reviewed pull request. Use whenever a user asks for a code change or bug fix; do not use for read-only analysis, explanation, review, planning, or when the user explicitly says not to implement or not to open a pull request.
---

# Ship a change

Carry the user's requested repository change from problem framing through a reviewed pull request.
The user's explicit instructions take precedence, including any request to stop before opening a pull
request.

Use the repository's [`AGENTS.md`](../../../AGENTS.md) files as the source of truth for engineering
judgment. Do not restate their design, trust, testing, or change-scope guidance in this skill.

## Before implementation

1. Read the root [`AGENTS.md`](../../../AGENTS.md), then follow its links to every narrower guide
   governing files the change may touch. Read only the relevant instruction branches.
2. Inspect the owning code and complete the analysis required by the applicable guidelines before
   editing. Share that analysis with the user when the guidelines require discussion.

## Implement and review

1. Work on a focused `codex/` branch unless the user supplied a branch or the current branch is
   already the correct one.
2. Implement the change and its tests according to every applicable `AGENTS.md`.
3. After implementation, review the complete diff against the user's request and the same
   guidelines. Resolve every actionable finding, then repeat the review until none remain.

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
