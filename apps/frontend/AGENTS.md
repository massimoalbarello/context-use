# Frontend architecture

The root guide applies here. This file adds React, routing, server-state, and UI-specific rules.
Organize the frontend around the paths and user journeys it renders; reserve global folders for code
that is genuinely shared across routes.

## Route-oriented structure

- `src/routes` mirrors the frontend URL tree. Each route owns its page composition, loader/guard,
  and URL parameters.
- Group route-specific components, queries, hooks, and tests by the same feature name as the route.
  Promote code to a cross-route feature only when several routes share the same domain behavior.
- `src/components` contains reusable, isolated UI primitives and app-wide layout components. It must
  not become a flat catalog of feature screens.
- Parent/layout routes own shared framing and navigation. Leaf route files should mainly compose
  feature components rather than implement an entire workflow inline.
- The router owns navigation and URL state. Components do not manually parse paths, call
  `history.pushState`, or install competing navigation listeners.

## Components and state

- A component has one UI responsibility and reads primarily as markup. Extract behavior into a
  focused hook or state machine when rendering becomes interleaved with async orchestration.
- Keep data fetching, mutation workflows, and cache invalidation out of presentational components.
  Presentational components receive typed values and callbacks and can render in isolation.
- Keep state at the narrowest owner. Do not duplicate server data into local state unless it is a
  deliberate editable draft with a defined synchronization rule.
- Prefer composition over a universal component with many mode flags. Component props form one
  coherent contract; split the component when different callers use unrelated subsets.
- Reuse components when interaction semantics and accessibility behavior are the same, not merely
  because markup looks similar.
- Every reusable component handles its loading, empty, error, disabled, focus, and accessibility
  states as applicable without relying on a specific route shell.

## Server data and contracts

- The API client is `treaty<App>` in `src/lib/api.ts`, typed from the backend workspace export. Do
  not introduce a second generated or handwritten API schema.
- Query modules own API calls, query keys, and query-option factories for their route or feature.
  Components never call the raw API client directly.
- Hooks in `src/lib/hooks` consume query options and expose UI-facing operations. Keep query
  mechanics out of route and presentation components.
- Mutation success updates or invalidates the canonical query data. Do not add refresh counters or
  maintain a parallel cache in component state.
- Treat query keys as owned data. Define each key family once and reuse it for reads, mutations, and
  invalidation.
- Eden returns `{ data, error }`; convert its structured error with the shared API error mechanism
  rather than duplicating response parsing in each caller.
- Adding or moving a route updates the generated route tree through the existing Vite plugin. Do not
  edit `src/routeTree.gen.ts` by hand.

## Styling and tests

- Keep app-wide tokens and resets global. Keep feature or component styles with their owner.
- Do not mix a structural refactor with an unrelated visual redesign or styling-system migration.
- Test accessible behavior and important user-visible state transitions. Query by role, label, and
  visible content rather than class names or incidental DOM nesting.
- Test route integration only when routing, loading, or URL behavior is the risk. Test isolated
  components without booting the full app when the route adds no relevant behavior.
- Share render harnesses, router setup, request handlers, and builders in `test/support`. Keep a
  feature fixture local when it is meaningful only to that route or feature.
- Avoid snapshots of whole screens and near-duplicate tests of the same component through several
  routes.
