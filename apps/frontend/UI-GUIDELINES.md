# Context Use interface guide

This guide defines the durable UI/UX rules for Context Use. It records product language and shared
interaction contracts, not current DOM structure or one-off implementation details.

## One visual system

The dashboard is one product. Consistency across routes and states is more important than local
novelty.

- Build generic controls and surfaces from the established shadcn/ui components in
  `src/components/ui`.
- The tweakcn **Minimal Neutral** theme is the canonical baseline: its semantic tokens, DM Sans,
  Geist Mono, radii, borders, elevation, and interaction states are the source of truth.
- Do not hand-style a native control when a shadcn primitive owns the interaction. Do not create a
  local near-match for an existing color, spacing, radius, shadow, font, focus state, or component
  variant.
- Compose product-specific layout with semantic tokens and Tailwind utilities on the shared React
  component that owns it. Custom component or feature CSS files are forbidden by an architecture
  test; only `src/styles/minimal-neutral.css` remains as the canonical theme.
- Preserve that theme as one baseline instead of pruning or overriding individual token families.
  Application styling belongs in component utilities; the theme file admits no unrelated rules.
- Extend a shared token, primitive, or layout pattern when a recurring need is real. Keep a
  difference local only when it communicates a genuine product distinction.
- Use the same component for the same job everywhere. Hover, focus, selected, disabled, loading,
  and editing states are part of that component contract, not route-specific styling.
- Keep the interface monochrome until color has a stable semantic purpose in the shared token
  system.

Before introducing markup or styling, check whether an existing shadcn primitive, shared component,
or variant already owns the decision. A genuinely indispensable global CSS responsibility requires
an explicit architecture change, not a local stylesheet. Repeated fine-tuning across screens means
the shared owner is missing or wrong.

## Product and resource language

Use the relationship verb that expresses the domain:

- Entities are **mentioned**.
- Knowledge pages are **referenced**.
- Records are **sources** or **evidence**.
- Assets are **attached** or **embedded**.

External MCP consumers are **MCP clients**. Settings groups them as **Authenticated clients** and
**Archived clients** and uses client language for approval, naming, and lifecycle actions. The
owner-scoped authorization is an internal identity boundary, not a user-facing “connection.”

Do not replace a known relationship with generic “link” language. The interface must make it easy
to move from pages to mentioned entities, referenced pages, and pages that reference or mention the
current resource.

Each resource type owns one reusable identity component:

- Entities are identity-led: portrait or stable fallback mark, name, and—when space permits—a
  distinguishing description or type.
- Entity images are ordinary image assets, not a separate upload store, but one image asset can
  identify at most one entity. Entity edit mode exposes image changes through the avatar and lets
  people choose an available image asset or stage a new upload. A staged upload is created and
  assigned on Done; its asset name is derived from the entity, and address collisions receive the
  standard generated suffix without exposing technical identity controls. Every entity surface
  falls back to the stable identity mark when no usable image is assigned.
- Pages are document-led: document cue, H1 title, and—when space permits—a short excerpt computed
  from the first meaningful body text after the H1.
- Assets are file-led: a safe thumbnail or file cue, meaningful name, and—when space permits—format
  and size. They must not masquerade as pages or entities. Records receive their own identity
  language when their product meaning is implemented.

Outside rendered Markdown, resources appear through these type-owned card components in sidebars,
pickers, search, and relationship views. The shared card surface owns dimensions, padding, hover,
focus, and selection; the resource component owns its internal identity. Keep cards in a collection
the same size and truncate variable text with an ellipsis.

At rest, resource cards are visually quiet. Hover reveals a temporary surface; selection is
persistent and clearly stronger than hover. Use the same states everywhere, and never rely on a
grey fill alone to communicate selection. Resource cards must remain distinguishable from form,
dialog, and layout containers.

Rendered Markdown is the exception: page references are typographic links and entity mentions use
their compact identity treatment, keeping the two relationships legible inside prose.

## Linking and stable identity

The editor has one discovery gesture: `@` searches all linkable resources. Mixed results use the
established resource components so type is visually obvious; do not add a trigger for every type.
Keyboard navigation keeps the active result visible.

Selecting a result stores a readable, typed link. Every resource also has an internal UUIDv7. The
server derives the readable address from the initial title or name; creation forms never ask the
user to author one. A collision asks for a more specific title or name while offering an explicit
option to keep it and append a short generated suffix. The resulting address then remains stable:
changing a title or name must not rewrite existing Markdown links. Stable addresses are technical
identity, not ordinary editable or reading content.

## Workspace and navigation

Knowledge is the dominant content. Navigation, forms, and application chrome support it without
competing for the screen.

- Use one viewport-sized neutral canvas with a bounded, collapsible sidebar and a large foreground
  content surface. Rounded corners belong to the foreground surface; the background fills the
  viewport.
- Resource lists scroll inside their available region and load incrementally. They never grow the
  shell or render the entire knowledge base at once.
- Keep selection and the contextual New action in the sidebar. Do not repeat the active collection
  tab as another heading. Keep the owner profile and sign-out action at the bottom.
- Choose the active resource collection from one compact selector beside its contextual New action;
  do not add a horizontal tab for every new collection.
- Remember the last selected entity, page, and asset for the browser session. Switching collections
  returns to that resource. Opening any page card or page link selects its sidebar card and opens
  Preview.
- Creation starts from an action and gets a focused route, dialog, or surface; creation forms never
  permanently occupy the main workspace.
- When collapsed, expose one menu control in the foreground surface corner. Do not stack placeholder
  branding or carve conflicting shapes into the canvas.
- Do not add a top header or primary-navigation item unless it owns a real product task.

On narrow screens the sidebar may become a drawer, but navigation and selected content keep the
same ownership.

## Detail views and actions

- Tabs switch views and use one shared underline treatment. Buttons perform actions; content cards
  and links must not look like buttons or tabs.
- The tab list sits below the shared heading row and above the active panel. Never place tabs beside
  the content they control.
- Pages may expose Preview, Links, and Revisions. A page renders its H1 once from Markdown in
  Preview; do not duplicate the title, revision number, or update timestamp in shell chrome.
- Entities keep their type, name, and distinguishing description visible because those fields are
  their identity.
- Every current and future resource detail shell—including entities, pages, and assets—shares the
  same content alignment, heading row, spacing rhythm, and top-right action anchor. Adding a
  resource type means extending this shared contract, not creating another detail pattern.
  Resource-specific content begins strictly below the heading row.
- The shared resource-detail action component owns action wording, order, size, and pending state.
  At rest, `Edit {resource}` precedes lifecycle actions. Entering edit mode replaces that group with
  `Cancel` followed by `Save {resource}` at the same top-right anchor. Routes must not rebuild that
  button group or shift the header, spacing, or content.
- Resource-like management cards with editable identity and lifecycle actions follow that same
  contract. At rest, values are read-only and the top-right action group contains `Edit {resource}`
  followed by lifecycle actions such as `Archive`. Entering edit mode mounts the fields in place and
  replaces the entire action group with `Cancel` followed by `Save {resource}`. Never leave editable
  fields or save controls visible at rest, move lifecycle actions below the form, or invent a second
  action placement for a card.
- Edit displayed identity in place when the presented and editable values are the same concept.
  Entity and asset names use the shared resource-name display and input treatment, so editing swaps
  the H1 for a matching field without duplicating content in a form card or adding an “editing”
  badge.
- On asset details, opening and downloading are different promises. Open uses the ordinary content
  URL in a new tab with inline disposition; Download requests attachment disposition explicitly.
- Preserve deliberate space between the heading row and the first tab or field. Remove dividers,
  borders, nested cards, and metadata that do not clarify grouping or interaction.

## Authentication and system states

Authentication, onboarding, empty states, and recoverable failures use the same primitives and
visual language as the workspace.

- If no owner passkey exists, lead with sign-up. First-time onboarding registers the passkey and
  creates the owner's entity before entering the workspace.
- Do not insert a marketing screen between the user and the available authentication task.
- Missing, empty, loading, and recoverable error states must look intentional and offer a useful
  next action. Reserve crash-style boundaries for unexpected failures.

## Forms and validation

- Creation routes share the same focused shell, compact heading, description, field rhythm, and
  bottom primary-action placement. Differences must follow the resource input itself, not a new
  page composition.
- File selection keeps the native input accessible but does not expose the browser-specific
  combined control. Present the established outline-button trigger and the selected filename as
  separate elements, with size guidance beneath them.
- Do not present untouched forms as erroneous. Show required-field errors only after the user
  attempts the action, then update those errors as the user edits.
- Keep the primary action available before validation so the first submit attempt can reveal what
  needs attention. Disable it only while the action is pending or genuinely unavailable.
- Keep technical identifiers and derived metadata out of ordinary forms. Ask for user intent, not
  implementation details the system can derive safely.

## Review checklist

Stop and fix the shared system when:

- the same job uses different components, spacing, alignment, or interaction states across routes;
- a generic control or surface is hand-built instead of using the established shadcn primitive;
- a component or feature adds a custom stylesheet instead of composing the established primitives,
  tokens, and variants;
- a feature introduces a one-off token or near-match for an existing style;
- entering edit mode moves actions or causes a visible layout shift;
- untouched fields are red, or a disabled primary action prevents submit-first validation;
- cards resize with content, or hover, focus, and selection are inconsistent;
- the same resource type has unrelated identity treatments in different contexts;
- entities and pages can be distinguished only by reading a type badge;
- tabs look like buttons, content looks like an action, or a recoverable state looks like a crash;
- a sidebar or picker renders an unbounded list or makes the whole workspace scroll;
- nested cards, borders, dividers, metadata, or repeated headings compensate for unclear hierarchy.
