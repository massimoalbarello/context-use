# Contributing to <repository-name>

## Development setup

```bash
git clone <repository-url>
cd <repository-name>
bun install
cp apps/backend/.env.example apps/backend/.env
bun run dev
```

Context Use generates a development auth secret inside `DATA_FOLDER`. Set `BETTER_AUTH_SECRET` in
`apps/backend/.env` only to override it.

## Before opening a pull request

```bash
bun fix:codestyle
bun check:all
bun run test
bun run build
```

Exercise the changed behavior locally as well; passing static checks is necessary but does not
prove runtime behavior.

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/) for pull request titles and
commits to `main`. CI rejects a pull request title that does not follow the convention.

## Pull requests

Follow the repository-local [open-pull-request skill](../.agents/skills/open-pull-request/SKILL.md)
when drafting or opening a pull request.
