# Backend invariants

The [root engineering principles](../../AGENTS.md) apply here. More specific guidance lives in the
[database](./src/db/AGENTS.md), [transport](./src/routes/AGENTS.md), and
[backend test](./test/AGENTS.md) guides.

## Layer ownership

- `models/` owns domain data and pure rules; `repositories/` owns persistence contracts and
  adapters; `services/` owns application workflows; `routes/` owns transport mapping; `db/` owns
  database infrastructure. Keep the top level organized by these layers and organize capabilities
  beneath them.
- Repository contracts live with their capability. Models contain no persistence, transport, or
  service contracts. Services depend on repository contracts, never concrete adapters or database
  clients.
- The production entry point is the composition root. It owns infrastructure lifetimes and passes
  dependencies into application, controller, and plugin factories. Module imports remain free of
  resource acquisition and global mutation.

## Identity and persistence

- Carry the authenticated actor and resource owner explicitly through controllers, services, and
  repository contracts.
- Scope every owner-controlled read, mutation, uniqueness rule, storage key, cache key, and emitted
  event by its owner. Across ownership boundaries, preserve indistinguishable not-found behavior so
  an identifier cannot reveal another owner's data.
- Keep domain and application contracts independent of a database client or SQL dialect. A new
  database gets its own repository and migration adapters behind the existing domain contracts;
  dialect switches do not spread through services or routes.
- Keep a transaction around one business invariant. Do not hold it open across network or object
  storage operations unless the design proves the failure and recovery semantics.
