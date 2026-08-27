# Contributing to <repository-name>

## Development setup

```bash
git clone <repository-url>
cd <repository-name>
bun install
```

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/) for commit messages to the main branch. Make sure your PR title is in the correct format.

## Pull requests

Keep each pull request focused. Use a concise Conventional Commit title that describes the
outcome. Start the body with a short paragraph explaining what changed and why, then add decisions,
tradeoffs, risks, migration notes, follow-up context, or `Closes #<issue>` only when useful.

Treat the body as reviewer context rather than an execution log. Omit routine successful
validation, local tooling problems, unavailable optional validators, fallback checks, generic
checklists, implementation trivia, and raw command output. Mention a validation gap only when it
leaves material risk or requires reviewer action, and explain its consequence.
