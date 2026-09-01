# Backend architecture

The root guide applies here. This file adds backend-specific Elysia, layering, and deployment rules;
database migration rules live in `src/db/AGENTS.md`.

## Structure and boundaries

- Keep the top level structural rather than feature-based: `models/` owns domain data and pure
  rules, `repositories/` owns persistence contracts and adapters, `services/` owns application
  workflows, `routes/` owns HTTP, `db/` owns database infrastructure, and `lib/` contains narrowly
  named cross-cutting technical support. Do not add top-level folders for individual resources.
- Organize models, repositories, and services by capability beneath their layer, mirroring the
  route tree: `models/entities/model.ts`, `repositories/entities/repository.ts`,
  `services/entities/service.ts`, and `routes/api/entities/controller.ts`. Keep only genuinely
  layer-wide bases at the layer root.
- Repository contracts live with the repository capability that owns them. Models must not contain
  persistence interfaces, SQL shapes, or service contracts. Services depend on those repository
  contracts, never on concrete repository classes.
- `lib/` is not a fallback for code that lacks an obvious home. Business parsing, validation, and
  value rules belong in `models/`; route-specific support belongs in `routes/`. Add `views/` only
  when reusable read projections or serializers exist independently of route-local schemas.
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
- Name result-producing repository queries through the typed SQL client and regenerate
  `src/queries.gen.ts` with `bun generate:queries`. Generated result types describe adapter rows
  only; repository contracts, domain models, and row-to-domain mapping remain handwritten.
- Treat migrations as the source of truth for generated query types. Add SQLite `@notNull` or
  `@type` query annotations only when the query and schema prove the stronger result invariant;
  never edit `src/queries.gen.ts` directly.
- Scope every user-owned read, mutation, uniqueness rule, cache key, storage key, and emitted event
  by its owner where applicable. Preserve indistinguishable not-found behavior across ownership
  boundaries so identifiers cannot reveal another user's data.
- Add another database as a separate repository and migration adapter behind the established
  contracts. Do not spread dialect switches through controllers, services, or domain logic.

## API contracts

- Validate all untrusted path, query, header, and body input at the route boundary.
- Expose entities, knowledge pages, and assets by immutable `readableId` and their typed
  `context-use://` address. Database UUIDs remain internal to domain and persistence models; omit
  them from HTTP schemas and map response presenters explicitly instead of spreading internal
  resource objects.
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
- Treat upload headers, filenames, and browser MIME types as optional hints. Services derive
  authoritative size, type, safe extension, and content hash from the received bytes; storage keys
  remain private implementation details. If an object write precedes its database transaction,
  compensate the object on persistence failure and verify stored bytes on every protected read.

## Tests

Backend tests live in `test` and mirror the production path of the capability or boundary they
exercise wherever one source owner exists. Read and follow `test/AGENTS.md` before adding or
changing them. Prioritize authorization and tenant isolation, data integrity, destructive
operations, transactions, idempotency, and public API contracts.

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
