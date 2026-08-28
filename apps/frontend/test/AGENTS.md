# Frontend tests

The root and frontend guides apply here. Use React Testing Library and `user-event` when rendering
React behavior.

Browser end-to-end testing is not part of the current baseline.

## Layout and support

- `test/support` owns the shared render function, fresh Router and Query clients, request handlers,
  authenticated principals, and reusable builders. Keep feature-only data beside its tests.
- Every render receives fresh state. Tests must not share caches, routers, form instances, DOM
  state, request handlers, or mutable fixtures.
- Keep the shared render input cohesive. Split specialized harnesses instead of accumulating flags
  for unrelated providers or scenarios.

## Test behavior

- Test accessible behavior and important user-visible transitions through roles, labels, visible
  content, and `user-event`; do not assert class names, hook calls, or incidental DOM structure.
- Test a route only when navigation, loaders, guards, URL state, pending states, or error boundaries
  are the risk. Test a component in isolation when route integration adds no relevant behavior.
- Mock at the API boundary with production request and response types. Do not mock TanStack Query,
  Router, or Form internals, and do not recreate backend contracts in test-only types.
- Prefer focused assertions over whole-screen snapshots. Cover loading, empty, error, disabled, and
  success states only where each represents a meaningful product risk.
