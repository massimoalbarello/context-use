# Backend test invariants

The [root](../../../AGENTS.md) and [backend](../AGENTS.md) guides apply here.

- Mirror the owning production capability or boundary under `test`. Put a test spanning several
  modules at their nearest shared boundary.
- Limit `test/support` to genuinely shared composition, lifecycle, principals, builders, clocks,
  and focused assertions. Keep feature-specific support with its feature.
- Each test owns its state and cleanup. Tests must pass independently and in randomized order.
- Assemble the application through an explicit test composition root. Production and tests supply
  dependencies to the same application factory; do not depend on production singletons, process
  globals, or module-mocking side effects.
- Use a fresh database with the production schema for each database test. Prefer the real in-process
  adapter for persistence behavior; use a fake only at an external, slow, destructive, or
  nondeterministic boundary, implementing the production contract.
- Exercise HTTP behavior through the assembled Elysia application. Test services directly for
  business decisions, and repositories directly for database invariants. When authorization,
  transactions, or data loss are the risk, assert resulting state as well as the response.
