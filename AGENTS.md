# Context Use

Context Use is an Elysia API and a React SPA in one Bun workspace, compiled to a single binary
that carries the built frontend and SQL migrations inside it.

## Engineering principles

- Keep changes narrow and cohesive. Do not mix a feature, an unrelated refactor, and dependency
  upgrades in the same pull request.
- Preserve dependency direction and module boundaries. If a change appears to require bypassing
  a layer, change the design instead of adding a shortcut.
- Prefer explicit, local code over speculative abstractions. Extract shared behavior only when
  there is a real reuse case and one owner for the abstraction.
- Treat types, schemas, constants, and generated clients as sources of truth. Derive from them
  instead of maintaining parallel representations.
- Add or update tests for changed behavior. A bug fix requires a regression test whenever the
  behavior can be exercised deterministically.
- Before adding a dependency, confirm the platform or an existing dependency does not already
  solve the problem. Record meaningful dependency or architecture tradeoffs in the pull request.

## Backend

- **Controller → service → repository, and never skip a layer.** A controller holds no logic and
  no SQL; a service holds no SQL; a repository holds no business rules.
- `routes/` mirrors the served path — `GET /api/health` is `routes/api/health/controller.ts`.
  The `/api` prefix is applied once in `routes/api/controller.ts`, so children write bare paths.
  Schemas live beside the controller in `model.ts`.
- Imports use the `#*` subpath mapping (`#lib/env.ts`, `#services/plugins.ts`), with the `.ts`
  extension. The frontend uses relative paths — it has no mapping.
- Every route declares its `body`/`response` schemas. They are what validates the request *and*
  what generates `/openapi`, so an undeclared response is an undocumented one.
- A route needing a session opts in with `.guard({ auth: true })` and reads `user`/`session` off
  its context. Every query is scoped by the owner's id in the `WHERE` clause.
- Services are instantiated once in `services/plugins.ts` and handed to controllers through an
  Elysia `.decorate` plugin. Don't construct one inside a handler.
- A migration is the next-numbered file in `db/migrations/`. They run at startup, in order, once.
  Never edit one that has shipped.
- A timestamp is a `text` column holding an ISO-8601 string, `string` on the row and `t.Date()` in
  the schema — `file.createdAt` end to end. Never `t.String()` for a date, and never `datetime('now')`.

## Frontend

- The API client is `treaty<App>` in `lib/api.ts` — typed from the server instance, so a route
  that changes shape breaks the caller at compile time. There is no schema to regenerate.
- A resource gets a `queryOptions` object in `queries/`, and hooks in `lib/hooks/` consume it.
  Components call hooks, not `api` directly.
- A response type is derived from the client, never hand-written:
  `NonNullable<Awaited<ReturnType<typeof api.api.files.get>>['data']>[number]`. A `types.ts`
  mirroring the API is a second source of truth, and it drifts.
- Eden answers `{ data, error }`, where `error` is a `{ status, value }` object rather than an
  `Error`. Every caller throws `new Error(apiErrorMessage(error))`; a bare `throw error` hands
  React an object where it expects a message and renders `[object Object]`.
- Adding a route means adding a file under `routes/`; the plugin regenerates `routeTree.gen.ts`.

## Validation

After an implementation, run:

```bash
bun fix:codestyle
bun check:all
bun test
bun run build
```

`fix:codestyle` writes what Biome can fix on its own, so `check:all` is left reporting only what
needs a decision. The test suite verifies behavior, and `bun run build` proves the deployable
binary still compiles with its embedded assets and migrations.

None of that is verification. Types and lints pass on code whose data is the wrong shape at
runtime, so exercise the route you changed against a running server before calling the work done.

## Pull requests

- Use a concise title that describes the outcome and follows Conventional Commit style; CI checks
  it.
- Open the body with a short paragraph explaining what changed and why for a reviewer who was not
  part of the implementation.
- Include decisions, tradeoffs, risks, migration notes, or follow-up context only when useful. Add
  `Closes #<issue>` only when closure is intended.
- Treat the body as reviewer context, not an execution log. Omit routine successful validation,
  local tooling problems, unavailable optional validators, fallback checks, and raw command output.
- Mention a validation gap only when it leaves material risk or requires reviewer action; explain
  the consequence rather than the tooling trivia.
- Avoid generic checklists, padded three-bullet summaries, and implementation trivia.
- Keep generated files, documentation, examples, and environment templates in sync with the code
  that owns them.
- Do not merge with failing required checks or unresolved review comments.

Follow the repository-local [open-pull-request skill](./.agents/skills/open-pull-request/SKILL.md)
whenever drafting or opening a pull request.

## Deploy the app

`bun run build` produces `backend/dist/app`, a single binary targeting **linux x64 (glibc)** with
the frontend and migrations inside it. It listens on `PORT` and expects the variables in
[backend/.env.example](./backend/.env.example).

Run it on [nibrun](https://nibrun.com): drop the binary, get an HTTPS URL and a disk that survives
every redeploy. `BASE_URL` can stay unset there — nibrun injects `NIBRUN_HOSTNAME` and
[env.ts](./backend/src/lib/env.ts) derives `https://<that hostname>` from it.
The repository-local [deploy-to-nibrun skill](./.agents/skills/deploy-to-nibrun/SKILL.md) has the
commands, the guest contract, and the tradeoffs. Follow it for every deployment.
