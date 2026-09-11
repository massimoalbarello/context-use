---
name: open-pull-request
description: Open a GitHub pull request for this repository with a concise Conventional Commit title and reviewer-focused body. Use when asked to create, open, submit, or draft a pull request, or to prepare a PR title or description.
---

# Open a pull request

## Prepare

1. Read `AGENTS.md` and any instructions governing the changed files.
2. Review the complete branch diff against its intended base, the commit history, and any linked
   issue. Confirm the pull request contains one cohesive change and no unrelated files.
   Inspect related pull requests and documented plans when needed to understand what led
   to this change and what it enables next. Verify references and their connection to the change.
3. Complete the validation required by `AGENTS.md` before opening the pull request. Resolve
   failures that affect correctness. Do not turn successful routine validation into PR-body
   content.
4. Check whether the branch already has an open pull request. Do not create a duplicate.

## Write the title

- Describe the outcome concisely and match the repository's Conventional Commit-style history.
- Choose the narrowest accurate type, such as `feat`, `fix`, `refactor`, `docs`, `test`, `ci`, or
  `chore`.
- Describe the user- or system-visible result rather than the implementation process.
- Validate the title with `bun check:commit-message` when that script is available.

## Write the body

- Use two sections, `## Why` followed by `## How`. Write for a reviewer who was not part of the
  implementation.
- Add `Closes #<issue>` only when merging the pull request should close that issue.
- Avoid generic checklists, padded three-bullet summaries, implementation trivia, and raw command
  output.
- Treat the body as reviewer context, not an execution log. Omit routine validation, local tool or
  runtime problems, unavailable optional validators, and fallback checks when CI or equivalent
  coverage succeeds.
- Mention a validation gap only when it leaves material risk or requires reviewer action. Explain
  the consequence and required action, not the tooling trivia.

### Why

- Explain the problem or need that prompted the pull request and why it matters now.
- Tell a concise, connected story of how this change fits into the repository's ongoing work:
  what earlier work established, what remains to be addressed, and how this pull request advances
  the intended direction or enables known next steps. Ground this context in verified history,
  documented plans, or the requester's stated intent; do not invent a roadmap or force connections
  for a standalone change.
- Reference relevant pull requests with `#<number>` or links when they help explain that story.
  Explain the relationship in the prose, such as building on an earlier change, resolving a gap
  it left, or preparing for a planned follow-up. Include only references that clarify the reason
  for this pull request, rather than listing related work without context.

### How

- Open with a short paragraph explaining what changed and the resulting behavior.
- Include decisions, tradeoffs, risks, migration notes, or follow-up context only when they help
  the reviewer evaluate the change. Keep motivation and broader project direction in `Why`.

## Open and verify

1. Push the intended branch if it is not already available to the remote.
2. Open the pull request with an explicit base branch, title, and body. Do not rely on an
   auto-generated body.
3. Read the created pull request back and verify its URL, base, head, title, body, and issue-closing
   language.
4. Return the pull request URL and call out only material risk or required reviewer action.
