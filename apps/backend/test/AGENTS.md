# Backend tests

The root and backend guides apply here. This file defines backend-specific test composition and
proving boundaries. Keep behavior-oriented names and Given/When/Then clarity in ordinary,
type-safe TypeScript.

## Layout and support

- Mirror `src/routes`, `src/services`, and `src/repositories` under `test`.
- Limit `test/support` to shared application factories, database and storage harnesses, principals,
  clocks, builders, and focused assertions. Keep a feature-specific helper with its feature.
- Helpers expose domain actions and typed values, not private call sequences. Avoid a global world
  object, string-matched steps, inheritance hierarchies, or a universal scenario builder.
- Each test owns its state and cleanup. Tests must pass independently and in randomized order.

## Composition and isolation

- Build the application through an explicit test composition root. Production and test assemblies
  supply dependencies to the same application factory; tests do not import production singletons,
  mutate process globals, or rely on module-mocking side effects.
- Give each database test a fresh temporary SQLite database, apply the production schema through
  the production migration path, and create scenario data afterward through typed builders. The
  harness that creates state also owns its cleanup.
- Prefer real in-process SQLite for repository behavior and constraints. Use a fake only for a
  boundary that is external, slow, destructive, or intentionally nondeterministic, and implement
  the production interface rather than an independent test model.

## Choose the proving boundary

- Exercise routes through the assembled Elysia application's `handle(Request)` boundary. Route
  tests cover material HTTP behavior: authentication, validation, status mapping, and response
  contracts.
- Test services directly only for business decisions or state transitions that route tests cannot
  prove clearly. Supply small typed fakes for their infrastructure boundaries.
- Test repositories and adapters against the real system when the invariant depends on SQL
  constraints, transactions, locking, streaming, filesystem behavior, or an SDK contract.
- Assert resulting state as well as the response when data loss, authorization, transactions, or
  destructive behavior is the risk.
