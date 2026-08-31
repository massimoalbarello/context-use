# Frontend architecture

The root guide applies here. This file defines the React-specific owners and boundaries. Organize
the frontend around the paths and user journeys it renders; reserve global folders for code that is
genuinely shared across routes.

Read and follow [UI-GUIDELINES.md](./UI-GUIDELINES.md) for the product vocabulary, visual language,
workspace shell, and interaction conventions that every feature must preserve.

## Canonical owners

Use one mechanism for each responsibility:

- TanStack Router owns routes, loaders, guards, navigation, path parameters, and URL search state.
- TanStack Query owns server data, caching, background refresh, and mutation invalidation.
- TanStack Form owns form values, field state, validation timing, and submission state.
- The typed Eden client owns the frontend contract with the backend.
- React owns transient state local to a component or a small component subtree.
- shadcn/ui components built on Base UI own reusable interactive UI primitives.
- Tailwind CSS and global theme variables own styling and design tokens.

Do not introduce another router, server cache, form system, UI primitive library, styling system, or
global state library unless a concrete requirement cannot be handled coherently by these owners.
Discuss that gap and the tradeoffs before adding a competing mechanism.

## Route-oriented structure

- `src/routes` mirrors the URL tree. Each route owns its page composition, loader or guard, URL
  parameters, validated search parameters, and route-level pending, error, and not-found states.
- Put shareable or restorable view state such as filters, sorting, pagination, and selected tabs in
  typed URL search parameters, not parallel component state.
- Loaders coordinate route requirements and use TanStack Query to ensure or prefetch server data;
  they do not create a second cache.
- Group route-specific components, queries, hooks, and tests by the same path or feature. Promote
  code only when several routes share the same behavior and semantic contract.
- Parent or layout routes own shared framing and navigation. Leaf route files primarily compose
  feature components rather than implementing entire workflows inline.
- Components do not parse paths, call `history.pushState`, or install navigation listeners.
- The Vite plugin owns `src/routeTree.gen.ts`; never edit it by hand.

## Components and UI primitives

- `src/components/ui` contains shadcn/ui source components and no application or domain logic. Add
  only components required by a current feature and review the generated source and dependencies.
- The frontend intentionally uses relative imports rather than a TypeScript path alias. When adding
  shadcn source, keep the upstream Base UI implementation intact and normalize its imports to the
  local relative-import convention instead of adding an alias only to satisfy the CLI.
- Use Base UI consistently as the shadcn/ui foundation. Do not mix Base UI, Radix, React Aria, or
  hand-built versions of the same interactive primitive without an explicit design decision.
- Keep route-specific compositions beside their route or feature. Global component folders contain
  only genuinely reusable primitives, application-wide layout, or cross-route components.
- A component has one UI responsibility and reads primarily as markup. Keep data loading, mutation
  orchestration, navigation, and cache mechanics outside presentational components.
- Prefer composition over a universal component with mode flags. Reuse a component when callers
  share interaction semantics and accessibility behavior, not merely similar markup.
- Do not wrap every shadcn component. Add an application wrapper only when it establishes a real
  shared contract, behavior, or visual rule.
- Every reusable component handles its applicable loading, empty, error, disabled, focus, keyboard,
  and accessibility states without depending on a particular route shell.

## State and effects

`useEffect` is an escape hatch for synchronizing React with an external system. It must name that
external system and provide symmetrical cleanup when the synchronization creates a subscription or
resource.

Do not use an effect to:

- fetch server data or synchronize a component copy of query data;
- derive values that can be calculated during rendering;
- react to a user action that belongs in an event handler;
- submit or reset a form;
- navigate, enforce a route guard, or mirror URL state;
- orchestrate mutations, query invalidation, authentication, or application workflows.

Use TanStack Query, Router, Form, event handlers, or derived render values for those
responsibilities. If an effect appears necessary, first check whether ownership has been assigned
to the wrong layer.

Keep state at the narrowest owner. Do not duplicate server, router, or form state in React state
unless it is an intentional editable draft with an explicit synchronization rule. Do not add a
global client-state library until a concrete cross-route state model requires one.

## Server data, forms, and contracts

- The API client is `treaty<App>` in `src/lib/api.ts`, typed from the backend workspace export. Do
  not introduce a second generated or handwritten API schema.
- Query modules own API calls, query keys, and query-option factories for their route or feature.
  Components never call the raw API client directly.
- Define every query-key family once. Include every value that changes the result, choose stale
  times from the meaning of the data, and reuse the keys for reads, mutations, and invalidation.
- Mutation success updates or invalidates canonical query data. Do not add refresh counters or a
  parallel cache in component state.
- When a successful mutation makes the current detail unavailable, remove that exact detail query,
  let navigation proceed without awaiting background refreshes, and invalidate only surviving
  collection, picker, and relationship consumers. Never broadly invalidate a family in a way that
  refetches the newly unavailable detail. Verify the journey has no avoidable post-success 4xx
  requests, retries, or prolonged pending state.
- Treat authenticated Query data as session-scoped. Clear it across authentication transitions or
  include the actor in its query key; private data must never be reused by another principal.
- TanStack Form owns form state. Render it through accessible shadcn field primitives and map
  structured server errors through the shared API error mechanism.
- Configure required-field validation to begin on submit and revalidate on change afterward. Do
  not mount a creation form in an error state or disable its submit action merely because untouched
  required fields are empty.
- Backend validation remains authoritative. Add a client schema only when it improves a concrete
  form or URL boundary; do not duplicate backend contracts merely to adopt a schema library.

## Visual system

- The canonical token baseline is the tweakcn **Minimal Neutral** shadcn theme. Its semantic theme
  variables, DM Sans body type, and Geist Mono code type belong in `src/styles/minimal-neutral.css`;
  components consume those tokens and never recreate the palette locally.
- Generic controls and surfaces—buttons, inputs, textareas, tabs, badges, avatars, and ordinary UI
  cards—come from `src/components/ui`. Do not hand-style a native replacement in a feature when a
  shadcn primitive owns that interaction. Domain resource cards remain application components
  because their entity/page identity and selection semantics are product behavior.
- Establish a compact visual baseline before building feature screens: semantic color tokens,
  typography, spacing rhythm, radii, elevation, interaction states, content widths, and responsive
  behavior.
- Use one shared application shell and a small set of recurring page patterns for headers, content
  regions, sections, forms, lists, and empty or error states. These executable components are the
  frontend template; do not create a separate visual model that can drift from them.
- Build every screen from the established tokens, shadcn/ui primitives, and shared page patterns.
  Consistency takes precedence over route-specific novelty.
- Compose application layout with semantic theme tokens, Tailwind utilities, and `cva` variants
  colocated with the React component that owns the behavior. Do not add component or feature
  stylesheets.
- `src/styles.css` is only the Tailwind/theme entry point and `src/styles/minimal-neutral.css`
  preserves the selected tweakcn theme as one baseline. Tailwind Preflight owns the reset. Put
  ordinary application styling in component utilities; add a global rule only for indispensable
  document behavior that neither the theme, Preflight, nor a component can own. The architecture
  test enforces that boundary. An exception requires an explicit architecture decision and an
  update to that test; convenience is not an exception.
- Add a token, component variant, or page pattern only for a recurring semantic distinction. Before
  adding one, simplify, extend, consolidate, or delete what already exists where possible.
- Treat nearly identical components, arbitrary visual values, growing variant matrices, and pages
  that require bespoke styling instructions as signs that the visual system needs simplification.

## Accessibility

- Prefer semantic HTML. UI primitives assist accessibility but do not replace correct labels, focus
  behavior, keyboard interaction, contrast, reduced-motion handling, or manual verification.
- Destructive confirmations use the shared shadcn/Base UI alert-dialog primitive. Do not use native
  browser confirmation APIs or introduce a second dialog mechanism.

## Tests

Frontend tests live in `test` and follow the same route, feature, and capability ownership as
`src`. Read and follow `test/AGENTS.md` before adding or changing them.
