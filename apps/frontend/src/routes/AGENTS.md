# Frontend route invariants

The [root](../../../../AGENTS.md) and [frontend](../../AGENTS.md) guides apply here. Route loaders
also follow the [query guidance](../queries/AGENTS.md).

- The route tree mirrors the URL tree. A route owns its loader or guard, URL state, page
  composition, and route-level pending, error, and not-found behavior.
- Put shareable or restorable view state in typed URL search parameters rather than parallel React
  state.
- Loaders coordinate route requirements through TanStack Query rather than creating another cache.
- Keep route-specific components and behavior with their route. Promote them only when several
  routes share the same semantic and interaction contract.
