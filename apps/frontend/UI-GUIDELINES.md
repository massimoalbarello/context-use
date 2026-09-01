# Context Use UI decisions

This guide records durable product language and cross-feature interaction decisions that require
judgment. It is not an inventory of implemented screens or components. Shared components remain the
executable source of truth for their behavior. Read it alongside the
[frontend engineering guide](./AGENTS.md).

## Visual system

Context Use is one product. Consistency across routes and states takes precedence over local
novelty.

- Build generic controls and surfaces from the established shadcn/ui primitives. Do not hand-build
  a competing version of an interaction the shared system already owns.
- Use the Minimal Neutral theme and its semantic tokens. Introduce color, tokens, variants, or page
  patterns only for recurring distinctions with stable product meaning.
- Extend or simplify an existing primitive, component, or layout pattern before adding another.
  Keep a difference local only when it communicates a genuine product distinction.
- Use the same component for the same job. Its hover, focus, selected, disabled, loading, error, and
  editing states are part of the shared contract rather than route-specific styling.
- Prefer clear hierarchy and deliberate space over nested cards, borders, dividers, repeated
  headings, and incidental metadata.

## Product language and resource identity

Use the relationship verb that expresses the domain:

- Entities are **mentioned**.
- Knowledge pages are **referenced**.
- Assets are **attached** or **embedded**.

Do not replace a known relationship with generic “link” language. External consumers are **MCP
clients**, not connections; authorization is an internal identity boundary rather than user-facing
product language.

Each resource type owns one reusable identity treatment:

- Entities are person- or organization-led: portrait or stable fallback, name, and distinguishing
  description or type when space permits.
- Pages are document-led: document cue, title, and a short body excerpt when space permits.
- Assets are file-led: safe thumbnail or file cue, meaningful name, format, and size when space
  permits.

Use those treatments consistently in sidebars, pickers, search, and relationship views. A shared
card surface owns geometry and interaction states; the resource treatment owns its identity. Hover
is temporary, selection is persistent and stronger, and neither may rely on color alone. Rendered
Markdown may use compact typographic links and mentions instead of cards.

The editor uses one `@` discovery gesture for all linkable resources. Mixed results retain their
resource-specific identity so type remains obvious.

## Workspace and navigation

Knowledge is the dominant content; navigation and application chrome support it without competing
for the screen.

- Use one shared workspace shell with a bounded, collapsible navigation region and a primary
  content surface. On narrow screens navigation may become a drawer without changing ownership.
- Keep collection selection, current-resource selection, and contextual creation actions in
  navigation. Resource lists scroll within their region and load incrementally.
- Creation begins with an explicit action and receives a focused route, dialog, or surface. Do not
  leave creation forms permanently in the main workspace.
- Add persistent chrome or primary navigation only when it owns a real product task.

## Detail views and editing actions

- Resource detail views share their content alignment, heading row, spacing rhythm, and top-right
  action anchor. Extend that shell when adding a resource type rather than creating another detail
  pattern.
- The shared detail-action component owns action wording, order, size, and pending state. At rest,
  `Edit {resource}` precedes lifecycle actions. Edit mode replaces the entire group with `Cancel`
  followed by `Save {resource}` at the same anchor; entering edit mode must not shift the layout.
- Resource-like management cards follow the same action contract. Values are read-only at rest;
  edit mode mounts fields in place and replaces all resting actions with `Cancel` and
  `Save {resource}`.
- Edit identity in place when the displayed and editable values are the same concept. Do not
  duplicate the value in a form card or add status decoration merely to announce edit mode.
- Tabs switch views, buttons perform actions, and links or content cards navigate. Preserve those
  distinctions visually and semantically.

## Forms and system states

- Creation surfaces share their hierarchy, field rhythm, and primary-action placement. Differences
  follow the information being requested rather than inventing a new composition.
- Ask for user intent, not technical identifiers or metadata the system can derive.
- Do not present untouched fields as erroneous. Begin required-field validation on the first submit
  attempt, then update errors as the user edits.
- Keep the primary action available before validation so it can reveal what needs attention.
  Disable it only while pending or genuinely unavailable.
- Loading, empty, missing, and recoverable error states must look intentional and offer a useful
  next action. Reserve crash-style boundaries for unexpected failures.
- Use semantic HTML and preserve labels, keyboard behavior, focus, contrast, and reduced-motion
  behavior. Shared primitives assist accessibility but do not replace manual judgment.

When an established UI pattern no longer fits, raise the conflict and decide whether the shared
pattern should change before adding a local exception.
