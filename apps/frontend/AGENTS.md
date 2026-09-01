# Frontend invariants

The [root engineering principles](../../AGENTS.md) apply here. The
[UI decision guide](./UI-GUIDELINES.md) is the canonical record of product language, visual
patterns, and interaction contracts. More specific engineering guidance lives with
[UI primitives](./src/components/ui/AGENTS.md), [queries](./src/queries/AGENTS.md),
[routes](./src/routes/AGENTS.md), and [frontend tests](./test/AGENTS.md).

## Canonical owners

Use one owner for each kind of state:

- TanStack Router owns routes, navigation, path parameters, guards, and URL search state.
- TanStack Query owns server data, caching, refresh, and mutation invalidation.
- TanStack Form owns form values, field state, validation timing, and submission state.
- The typed Eden client owns the frontend contract with the backend.
- React owns transient state local to a component or small subtree.
- Shared UI primitives own reusable interaction and accessibility behavior.

Introduce a competing router, cache, form system, client-state store, primitive library, or styling
system only when a concrete requirement cannot be handled coherently by the established owner and
the architectural tradeoff has been discussed.

## Components and state

- Presentational components do not own data fetching, mutation orchestration, navigation, or cache
  policy. Prefer composition over reusable components whose callers require mode flags.
- Keep state at its narrowest owner. Do not copy server, router, or form state into React state
  unless it is an intentional draft with an explicit synchronization rule.
- Use an effect only to synchronize with an external system. Data fetching, derivation, user
  actions, form operations, navigation, and application workflows belong to their established
  owners rather than `useEffect`.

## Contracts and trust

- Backend validation remains authoritative. Add client validation only when it improves a concrete
  form or URL boundary; do not duplicate backend contracts to create a parallel schema.
