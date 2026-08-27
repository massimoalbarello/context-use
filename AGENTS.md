## Project

Bun + TypeScript monorepo (`apps/*`, `packages/*`). The full-stack starter application lives in
`apps/backend` and `apps/frontend`; reusable code and configuration belong in `packages/*`.

## Stack

- **Runtime:** Bun
- **Monorepo:** Bun workspaces + Turbo
- **Backend:** Elysia + SQLite
- **Frontend:** React + Vite
- **Linter/Formatter:** Biome (auto-formats on save)
- **Commits:** Conventional Commits (commitlint)

## Code style

- No comments that restate what types and naming already say — only comment the non-obvious
- Backend imports use `#*` subpath mapping (e.g. `import { foo } from '#services/foo.ts'`)
- Single source of truth — never duplicate keys, enum values, or type info that belongs to a
  class/module; derive from the source instead
- Biome enforces `useMaxParams: 1` — wrap multiple params in an object
- Only re-export from index files — Biome enforces that

## Backend

- **Controller → service → repository, and never skip a layer.** A controller holds no logic and
  no SQL; a service holds no SQL; a repository holds no business rules.
- `routes/` mirrors the served path — `GET /api/health` is `routes/api/health/controller.ts`.
  The `/api` prefix is applied once in `routes/api/controller.ts`, so children write bare paths.
  Schemas live beside the controller in `model.ts`.
- Every route declares its `body`/`response` schemas. They validate requests and generate
  `/openapi`, so an undeclared response is an undocumented one.
- A route needing a session opts in with `.guard({ auth: true })` and reads `user`/`session` from
  its context. Every query is scoped by the owner's id in the `WHERE` clause.
- Services are instantiated once in `services/plugins.ts` and handed to controllers through an
  Elysia `.decorate` plugin. Don't construct one inside a handler.
- A migration is the next-numbered file in `db/migrations/`. They run at startup, in order, once.
  Never edit one that has shipped.
- A timestamp is a `text` column holding an ISO-8601 string, `string` on the row and `t.Date()` in
  the schema — `file.createdAt` end to end. Never `t.String()` for a date, and never
  `datetime('now')`.

## Frontend

- The API client is `treaty<App>` in `lib/api.ts`, typed from the backend workspace export. There
  is no schema to regenerate.
- A resource gets a `queryOptions` object in `queries/`, and hooks in `lib/hooks/` consume it.
  Components call hooks, not `api` directly.
- Response types are derived from the client, never hand-written.
- Eden answers `{ data, error }`, where `error` is a `{ status, value }` object rather than an
  `Error`. Every caller throws `new Error(apiErrorMessage(error))`.
- Adding a route means adding a file under `routes/`; the plugin regenerates `routeTree.gen.ts`.

## Validation

After finishing an implementation, always run:

1. `bun fix:codestyle` — auto-fix formatting/lint issues
2. `bun check:all` — verify types and codestyle pass
3. `bun test` — verify behavior
4. `bun run build` — verify the build succeeds

Exercise changed routes against a running server as well. Check `package.json` scripts at the root
and in the affected workspace before running commands.

## READMEs

Packages fall in two buckets:

- **Published packages** (have a `pkg/` directory) carry **two** READMEs:
  - **`packages/<package>/pkg/README.md`** — public, user-facing, and shipped to npm.
  - **`packages/<package>/README.md`** — internal contributor documentation. It must link to the
    public README and must not duplicate installation or usage guidance.
- **Internal-only packages** (no `pkg/`) need a README only when contributor-relevant context is
  not obvious from the source.

When editing a published package, update the documentation for the correct audience. If a change
belongs to both audiences, update both READMEs in lockstep.

The root `README.md` is the project homepage. Keep it short; deep usage belongs in package docs.

## Keeping this file up to date

When a change affects code style, tooling, conventions, or project taste, propose updating this
file to reflect it.

## Pull requests

Follow the repository-local [open-pull-request skill](./.agents/skills/open-pull-request/SKILL.md)
whenever drafting or opening a pull request.

## Deploy the app

`bun run build` produces `apps/backend/dist/app`, a single binary targeting Linux x64 with the
frontend and migrations embedded. It listens on `PORT` and expects the variables in
[apps/backend/.env.example](./apps/backend/.env.example).

The repository-local [deploy-to-nibrun skill](./.agents/skills/deploy-to-nibrun/SKILL.md) contains
the deployment commands and platform constraints.
