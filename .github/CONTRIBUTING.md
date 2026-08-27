# Contributing to Context Use

## Development setup

```bash
git clone https://github.com/massimoalbarello/context-use.git
cd context-use
bun install
cp backend/.env.example backend/.env
```

Generate a development secret with `openssl rand -base64 32`, add it as
`BETTER_AUTH_SECRET` in `backend/.env`, then start both applications with `bun run dev`.

## Before opening a pull request

```bash
bun fix:codestyle
bun check:all
bun test
bun run build
```

Exercise the changed behavior locally as well; passing static checks is necessary but does not
prove runtime behavior.

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/) for pull request titles and
commits to `main`. CI rejects a pull request title that does not follow the convention.

## Pull requests

Keep each pull request focused. Use a concise Conventional Commit title that describes the
outcome. Start the body with a short paragraph explaining what changed and why, then add decisions,
tradeoffs, risks, migration notes, follow-up context, or `Closes #<issue>` only when useful.

Treat the body as reviewer context rather than an execution log. Omit routine successful
validation, local tooling problems, unavailable optional validators, fallback checks, generic
checklists, implementation trivia, and raw command output. Mention a validation gap only when it
leaves material risk or requires reviewer action, and explain its consequence.

Resolve review comments and required checks before merge.
