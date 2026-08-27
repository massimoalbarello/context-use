# Backend architecture

The root guide applies here. This file adds backend-specific Elysia, layering, and deployment rules;
database migration rules live in `src/db/AGENTS.md`.

## Structure and boundaries

- Organize routes by API path. A route folder owns its request/response schemas, controller, and
  route-specific tests. Dynamic segments use the domain identifier (`[resourceId]`, not `[id]`).
- Apply shared path prefixes once in the parent controller; child controllers declare only their
  local path.
- Every endpoint follows controller → service → repository. Controllers own HTTP mapping,
  authentication, and validation; services own business orchestration; repositories own SQL and row
  mapping. Do not skip or mix these boundaries.
- Instantiate services once in `src/services/plugins.ts` and expose them through the shared Elysia
  plugin. Do not construct services inside handlers.
- Backend imports use `#*` subpath mappings (for example, `#services/foo.ts`).

## API contracts

- Validate all untrusted path, query, header, and body input at the route boundary.
- Every Elysia route declares its request and response schemas so runtime validation and OpenAPI
  stay aligned with the implementation.
- Keep response contracts explicit and derive frontend-facing types from the validated contract or
  typed client. Do not maintain backend and frontend copies by hand.
- Map known domain failures centrally and consistently. Do not scatter status-code decisions through
  repositories or reduce every failure to an untyped `Error` message.
- Preserve trust boundaries explicitly. Authentication, authorization, tenant filtering, and
  capability checks stay at the surface that owns them and cannot be weakened by shared code.
- Routes that require a session opt into the shared auth guard. Scope protected repository queries
  in SQL; never load a broader result and filter it in application memory.
- Keep transactions around one business invariant. Do not hold a database transaction open across
  network or object-storage calls unless the design explicitly proves why that is safe.

## Tests

- Route tests cover only material HTTP concerns: authentication, validation, status mapping, and the
  public response contract.
- Adapter integration tests use the real system for SQL constraints, permissions, transaction
  behavior, locking, streaming, and SDK assumptions that a fake cannot prove.
- Shared app factories, principals, clocks, and adapter harnesses belong in `test/support`; do not
  rebuild them in each test file.

## Red flags

- A controller contains SQL or coordinates a multi-step business workflow.
- A service maps HTTP responses or depends on an Elysia request context.
- A repository decides business policy or returns transport-specific models.
- A route lacks request or response schemas.
- A protected query fetches rows outside the authenticated scope.
- A handler constructs its own service or infrastructure client.

## Deployment

`bun run build` produces `dist/app`, a Linux x64 binary with the frontend and migrations embedded.
It listens on `PORT` and expects the variables in `.env.example`.

Follow the repository-local
[deploy-to-nibrun skill](../../.agents/skills/deploy-to-nibrun/SKILL.md) for deployment commands and
platform constraints.
