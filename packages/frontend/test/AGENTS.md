# Frontend test invariants

The [root](../../../AGENTS.md) and [frontend](../AGENTS.md) guides apply here.

- Use React Testing Library and `user-event` to exercise accessible behavior and meaningful
  user-visible transitions. Assert roles, labels, and content rather than class names, hook calls,
  or incidental DOM structure.
- Give every render fresh routers, query clients, request handlers, form state, and fixtures. Tests
  do not share mutable browser or application state.
- Test a route when navigation, loaders, guards, URL state, or route boundaries are the risk. Test a
  component in isolation when route integration proves nothing additional.
- Mock at the typed API boundary. Do not mock TanStack internals or recreate backend contracts in
  test-only types.
- Keep shared rendering support cohesive. Split a specialized harness rather than accumulating
  unrelated modes in one global test world.
