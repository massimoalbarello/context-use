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
  mapping. Keep each abstraction cohesive and give it an explicit contract; do not skip or mix
  these boundaries, or use them as permission for unrelated responsibilities.
- The production entry point is the composition root. It creates infrastructure resources,
  repositories, services, and the application so dependency ownership and lifetimes remain visible.
- Instantiate services once per application and pass application-owned dependencies explicitly to
  application, controller, or Elysia plugin factories. Use a factory only when it binds those
  dependencies or configuration, or owns per-application state; export a dependency-free,
  stateless plugin as an Elysia instance directly. Do not construct services inside handlers.
- Imports are side-effect free. Opening or closing database, storage, and network resources belongs
  to the composition root that owns their lifecycle.
- Backend imports use `#*` subpath mappings (for example, `#services/foo.ts`).

## Identity and persistence boundaries

- Treat the authenticated actor and resource owner as explicit inputs throughout controllers,
  services, and repository contracts. A process-global user or an unscoped “current user” is not an
  acceptable dependency, even while one user runs in an instance.
- Services depend on repository contracts that describe domain persistence, never on a database
  client or SQLite-specific implementation. Repositories implement those contracts and contain SQL,
  row mapping, transaction behavior, and database-specific failure translation.
- Scope every user-owned read, mutation, uniqueness rule, cache key, storage key, and emitted event
  by its owner where applicable. Preserve indistinguishable not-found behavior across ownership
  boundaries so identifiers cannot reveal another user's data.
- Add another database as a separate repository and migration adapter behind the established
  contracts. Do not spread dialect switches through controllers, services, or domain logic.

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

Backend tests live in `test` and follow the same route, service, repository, and adapter ownership
as `src`. Read and follow `test/AGENTS.md` before adding or changing them. Prioritize authorization
and tenant isolation, data integrity, destructive operations, transactions, idempotency, and public
API contracts.

## Red flags

- A controller contains SQL or coordinates a multi-step business workflow.
- A service maps HTTP responses or depends on an Elysia request context.
- A repository decides business policy or returns transport-specific models.
- A route lacks request or response schemas.
- A protected query fetches rows outside the authenticated scope.
- A handler constructs its own service or infrastructure client.
- A module import opens a resource or silently selects a production dependency.
- A service depends on a concrete database client or assumes a single process-wide user.

## Deployment

`bun run build` produces `dist/app`, a Linux x64 binary with the frontend and migrations embedded.
It listens on `PORT` and expects the variables in `.env.example`.

Follow the repository-local
[deploy-to-nibrun skill](../../.agents/skills/deploy-to-nibrun/SKILL.md) for deployment commands and
platform constraints.
