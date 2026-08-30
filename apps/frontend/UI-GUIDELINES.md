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
- Extend a shared token, primitive, or layout pattern when a recurring need is real. Keep a
  difference local only when it communicates a genuine product distinction.
- Use the same component for the same job everywhere. Hover, focus, selected, disabled, loading,
  and editing states are part of that component contract, not route-specific styling.
- Keep the interface monochrome until color has a stable semantic purpose in the shared token
  system.

Before introducing new CSS or markup, check whether an existing shadcn primitive, shared component,
or variant already owns the decision. Repeated fine-tuning across screens means the shared owner is
missing or wrong.

## Product and resource language

Use the relationship verb that expresses the domain:

- Entities are **mentioned**.
- Knowledge pages are **referenced**.
- Records are **sources** or **evidence**.
- Assets are **attached** or **embedded**.

Do not replace a known relationship with generic “link” language. The interface must make it easy
to move from pages to mentioned entities, referenced pages, and pages that reference or mention the
current resource.

Each resource type owns one reusable identity component:

- Entities are identity-led: portrait or stable fallback mark, name, and—when space permits—a
  distinguishing description or type.
- Pages are document-led: document cue, H1 title, and—when space permits—a short excerpt computed
  from the first meaningful body text after the H1.
- Records and assets receive their own identity language when their product meaning is implemented;
  they must not masquerade as pages or entities.

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
readable address is derived at creation, resolved explicitly on conflict, and then remains stable:
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
- Remember the last selected page and entity for the browser session. Switching collections returns
  to that resource. Opening any page card or page link selects its sidebar card and opens Preview.
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
- Pages may expose Preview, Links, and Revisions. A page renders its H1 once from Markdown in
  Preview; do not duplicate the title, revision number, or update timestamp in shell chrome.
- Entities keep their type, name, and distinguishing description visible because those fields are
  their identity.
- Page and entity detail shells share the same content alignment, heading row, spacing rhythm, and
  top-right action anchor. Resource-specific content begins strictly below the heading row.
- Entering edit mode replaces Edit with Cancel and Save at the same top-right anchor. It must not
  shift the header, spacing, or content.
- Edit displayed identity in place when the presented and editable values are the same concept.
  Reuse the established field treatment and keep editability obvious without duplicating content
  in a form card or adding an “editing” badge.
- Preserve deliberate space between the heading row and the first tab or field. Remove dividers,
  borders, nested cards, and metadata that do not clarify grouping or interaction.

## Authentication and system states

Authentication, onboarding, empty states, and recoverable failures use the same primitives and
visual language as the workspace.

- If no owner passkey exists, lead with sign-up. Setup registers the passkey and creates the owner's
  entity before entering the workspace.
- Do not insert a marketing screen between the user and the available authentication task.
- Missing, empty, loading, and recoverable error states must look intentional and offer a useful
  next action. Reserve crash-style boundaries for unexpected failures.

## Review checklist

Stop and fix the shared system when:

- the same job uses different components, spacing, alignment, or interaction states across routes;
- a generic control or surface is hand-built instead of using the established shadcn primitive;
- a feature introduces a one-off token or near-match for an existing style;
- entering edit mode moves actions or causes a visible layout shift;
- cards resize with content, or hover, focus, and selection are inconsistent;
- the same resource type has unrelated identity treatments in different contexts;
- entities and pages can be distinguished only by reading a type badge;
- tabs look like buttons, content looks like an action, or a recoverable state looks like a crash;
- a sidebar or picker renders an unbounded list or makes the whole workspace scroll;
- nested cards, borders, dividers, metadata, or repeated headings compensate for unclear hierarchy.
