# Context Use interface guide

This guide records the durable interface decisions for Context Use. It describes the product
language and experience that components must express, not the current component names, DOM shape,
or CSS implementation. Change these conventions deliberately and update this guide when the product
model changes.

## Design objective

Context Use is a working environment for navigating and refining a connected body of knowledge. The
interface should keep that knowledge—not navigation, forms, or application chrome—as the dominant
thing on screen.

- Prefer the smallest interface that makes the current task obvious.
- Preserve context while the user moves between related resources or changes view.
- Reveal creation and editing controls when requested instead of permanently allocating the
  workspace to them.
- Make every state feel like part of the application. Empty, missing, loading, and recoverable error
  states must not resemble a crash.

## Domain language is interface language

Use relationship verbs consistently in labels, headings, empty states, APIs surfaced to users, and
accessibility text:

- Entities are **mentioned**.
- Knowledge pages are **referenced**.
- Records will be **sources** or **evidence**.
- Assets will be **attached** or **embedded**.

Do not replace these with a generic verb such as “linked” when the relationship type is known. A
page can mention entities, reference other pages, and be referenced by pages. An entity is mentioned
by pages. The interface must make those directions easy to traverse.

## Resource identity

Entities, pages, records, and assets may share interaction behavior, but they are not visually or
semantically interchangeable. Users should be able to recognize a resource type before reading
supporting metadata.

- Each resource type owns one coherent visual language used everywhere it appears.
- An entity is identity-led: show a portrait, avatar, or stable fallback mark with its name and,
  where space allows, its distinguishing description or type.
- A page is document-led: show its title with a restrained document cue. Inline page references are
  text-led; page cards remain recognizable as documents rather than identity cards. Page cards show
  a short excerpt derived from the first meaningful body text after the H1, never a separately
  authored description.
- Do not make different resource types identical and rely on a small type label to repair the
  ambiguity.
- Do not make the same resource type look unrelated across the sidebar, pickers, relationship views,
  and content.

The outer container communicates context and interaction—inline link, compact result, sidebar row,
selected result, or card. The internal composition communicates resource type. Share small primitives
for focus, hover, selection, spacing, or containers when they have one semantic contract; keep each
resource's identity composition owned by that resource.

Outside rendered page prose, a resource result is always a card. Reuse the resource type's one card
composition in sidebars, relationship views, pickers, and search results; vary only density or
contextual metadata that those recurring contexts genuinely require. Rendered Markdown is the
exception: page references remain typographic links and entity mentions retain their compact
identity treatment so the two relationships stay legible inside prose.

All resource cards share one interactive surface contract for padding, border, radius, focus,
selection, and hover. Their internal identity remains type-owned. Give this resource-card surface a
recognizable treatment distinct from generic form panels, dialogs, and layout surfaces so users can
tell navigable knowledge from UI containment.

Resource-card chrome is interaction state, not permanent decoration. At rest, keep the shared card
surface transparent. On hover, reveal a quiet temporary surface. For the selected resource, retain a
white surface with a clear dark outline and restrained elevation; do not use a grey fill as the
selection signal. Keyboard focus must be at least as legible as hover. These states must be identical
in sidebars, pickers, search results, and relationship views.

Cards in the same resource-result system use one fixed height. Truncate titles, descriptions, and
page excerpts with an ellipsis instead of allowing content length to resize a result. A page excerpt
remains derived from its first meaningful body text; the card is only a compact preview of it.

Avoid a universal resource component with an expanding matrix of type and mode flags. A type-specific
component may offer a small number of presentations when those presentations are real, recurring
contexts with shared semantics. Future records and assets should receive their own language when
their product meaning is understood rather than being forced into page or entity conventions.

## Linking and selection

The editor has one discovery gesture: `@` searches all resources that can participate in the
hypermedia. The result presentation distinguishes entities, pages, and future resource types. The
selected result determines the typed relationship; the trigger character does not.

- Treat `@` as an authoring shortcut, not stored content or a domain identifier.
- Store a stable, readable, typed link after selection.
- Search by human-facing names or titles. Do not require users or agents to discover opaque IDs.
- Do not add a new trigger character for every resource type.
- Do not render exhaustive entity or page lists beside an editor. A searchable picker should reveal
  a bounded, relevant set of options.
- Preserve the established resource visuals inside mixed search results so type remains obvious.

## Workspace shell and navigation

The desktop workspace is a viewport-sized neutral canvas with a primary content surface and a
collapsible navigation sidebar on the same background plane. The content surface should feel like a
large, calm sheet floating over the canvas, not a collection of dashboard widgets.

- The workspace frame is fixed to the available viewport. Long resource lists scroll inside their
  bounded region and load incrementally; they must not grow the whole shell.
- The selected page or entity receives most of the available screen. Creation forms never occupy a
  permanent half of the dashboard.
- Creation begins with a clear action and opens a focused route, surface, or dialog appropriate to
  the task.
- Place the contextual creation action beside the collection tabs. The active tab already names the
  collection; do not repeat that name as a second heading below it.
- Keep resource selection in the sidebar. Keep profile and sign-out controls at its bottom.
- When the sidebar is collapsed, preserve the foreground surface and its rounded corner. Place one
  compact menu control inside that corner; do not carve an inverse notch out of the surface or stack
  unrelated logo and menu controls there.
- The canvas fills the screen. Rounded corners belong to the foreground surface, not to an
  arbitrarily ending background.
- Do not add a top application header unless it owns information or actions that cannot live in the
  sidebar or resource surface.
- Product navigation contains product tasks. Developer conveniences such as API documentation do
  not belong in the primary workspace navigation.

On narrower screens, preserve the same ownership even if the sidebar becomes an overlay or drawer:
navigation remains navigation and the selected resource remains the primary content.

## Views, actions, cards, and links

Controls with different jobs must not share an ambiguous treatment.

- Tabs switch views within the selected resource. Use one consistent tab treatment with a restrained
  underline for the active view.
- Filled black controls are actions, especially primary actions. Do not use button styling for tabs
  or passive content.
- White surfaces and cards represent content. Do not make ordinary content look like a primary
  action.
- Inline links remain typographic and visibly interactive without looking like tabs.
- Use resource views such as Preview, Links, and Revisions when those views exist. A revisions view
  may begin as a simple list; do not hide existing domain history merely because a rich comparison
  view is not ready.
- Remove dividers that do not clarify grouping, state, or interaction. Sharp rules around a rounded
  floating surface are usually evidence of competing layout models.

## Viewing, creating, and editing

Reading is the default state. Editing should preserve the reader's spatial context.

- Edit the displayed value in place when the editable value and the presented value are the same
  concept.
- Make editability perceptible through a quiet, consistent field treatment and clear save/cancel
  actions.
- Keep typography, spacing, and surrounding layout stable when entering edit mode.
- Do not duplicate the visible name and description in a second form card below them.
- Do not add an “editing” badge when the fields and actions already communicate the state.
- Keep creation forms compact and task-focused. Derive readable addresses from the entered name or
  page title whenever possible and ask for disambiguation only on conflict.

Most knowledge pages may ultimately be agent-authored, so manual creation must be usable without
dominating the product's information architecture.

## Visual baseline

The current baseline is deliberately monochrome: black, white, and neutral greys. Introduce color
only when it has a stable semantic job and belongs in the shared token system.

- Use one canvas color across the sidebar and every exposed part of the workspace background. A
  floating control should use the surface color of the layer it sits on.
- Use a restrained set of radii, spacing, border, and elevation tokens.
- Prefer whitespace and hierarchy over nested cards and repeated divider lines.
- Keep titles proportional to the task; utility and creation screens do not need marketing-scale
  headings.
- Do not show placeholder branding, brand initials, or icons that have no product meaning. Stable
  initials remain appropriate as fallbacks for entity portraits.
- A new one-off color, radius, shadow, or control treatment is a design decision, not a local fix.

## Authentication and system states

Authentication and onboarding are part of the workspace, not a separate visual product.

- Reuse the application's visual primitives and shell language for sign-up and sign-in.
- If no owner passkey exists, lead with sign-up. A sign-in attempt must explain that the instance has
  not been registered yet.
- Treat first-time setup as one flow: register the owner passkey, create the owner's entity, and only
  then enter the workspace.
- Do not insert a marketing landing page between the user and the only available authentication
  task.
- Render missing resources and other expected failures as calm, recoverable in-application states
  with a useful next action. Reserve crash-style error boundaries for genuine unexpected failures.

## UI/UX red flags

Stop and reconsider the design when:

- a form, toolbar, heading, or navigation region competes with the selected knowledge for most of
  the screen;
- an active navigation label is immediately repeated as a heading without adding context;
- a list renders every possible resource instead of using bounded search, pagination, or infinite
  scrolling;
- the whole page scrolls because a sidebar list is not constrained to the viewport;
- entering edit mode causes a large layout shift, duplicated content, or unexplained lines;
- tabs look like buttons, cards look like primary actions, or links look like tabs;
- entities and pages are distinguishable only by reading a type label;
- a resource result outside rendered Markdown is reduced to plain text or rebuilt with local markup
  instead of its type-owned card;
- the same entity or page uses a different identity treatment in each feature;
- hover and selection swap between unrelated card treatments in different features;
- a long title, description, or excerpt makes one resource result taller than its siblings;
- navigable resource cards and generic form or layout panels have no consistent visual distinction;
- relationship language drifts between “mention,” “reference,” “source,” “attachment,” and generic
  “link” terminology;
- every new resource type adds another editor trigger or parallel selection workflow;
- nested cards, borders, and dividers are being added to compensate for unclear hierarchy;
- adjacent parts of the workspace use almost-but-not-quite matching neutral colors, spacing,
  corners, or alignment;
- a recoverable empty or not-found state looks like the application crashed;
- a logo, badge, icon, metadata field, or navigation item is present without helping recognition,
  orientation, or action.
