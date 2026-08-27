# Backend architecture

`apps/backend` owns HTTP delivery and application orchestration. It does not own frontend behavior
or database implementation details.

## Structure and boundaries

- Organize routes by API path. A route folder owns its request/response schemas, controller, and
  route-specific tests. Dynamic segments use the domain identifier (`[resourceId]`, not `[id]`).
- Apply shared path prefixes once in the parent controller; child controllers declare only their
  local path.
- Controllers authenticate, validate input, invoke one application operation, and map its result to
  an HTTP response. They contain no SQL, persistence mapping, or multi-step business policy.
- Application operations own use-case sequencing and business decisions. They depend on narrow
  contracts for persistence, storage, queues, clocks, and external APIs.
- Infrastructure adapters implement those contracts. Database clients, SDK response shapes, retry
  mechanics, and transport-specific errors do not leak into application or domain code.
- Contracts are defined by the consumer that needs the capability, not as a union of every method an
  implementation happens to provide.
- Compose concrete dependencies in an app factory or entrypoint. Tests must be able to construct a
  controller or operation without connecting to real infrastructure.

Every endpoint follows the controller → service → repository direction. A simple layer may delegate
directly, but keeping the boundary prevents transport, business policy, and persistence from growing
together later.

## API contracts

- Validate all untrusted path, query, header, and body input at the route boundary.
- Every Elysia route declares its request and response schemas so runtime validation and OpenAPI stay
  aligned with the implementation.
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

## Design constraints

- A use case accepts one cohesive input object. Dependencies are constructor/factory inputs rather
  than optional parameters threaded through each call.
- Instantiate services once in `src/services/plugins.ts` and expose them through the shared Elysia
  plugin. Do not construct services inside handlers.
- Avoid manager/service classes that collect unrelated operations. Prefer names that state the exact
  capability or use case.
- Keep reads and writes distinct when they have different authorization, consistency, or dependency
  requirements.
- Share cross-route business rules through the owning application/domain module, not by calling one
  controller from another.
- Importing a route, operation, or adapter must be side-effect free.

## Tests

- Domain and application tests protect business decisions, state transitions, ordering,
  idempotency, and failure handling through narrow dependency contracts.
- Route tests cover only material HTTP concerns: authentication, validation, status mapping, and the
  public response contract.
- Adapter integration tests use the real system for SQL constraints, permissions, transaction
  behavior, locking, streaming, and SDK assumptions that a fake cannot prove.
- End-to-end tests are reserved for a small set of critical journeys across boundaries.
- Shared app factories, principals, clocks, and adapter harnesses belong in `test/support`; do not
  rebuild them in each test file.
- Split integration suites by boundary or invariant family. Do not create a single regression suite
  that boots every backend concern and accumulates unrelated cases.
