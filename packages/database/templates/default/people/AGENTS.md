# People conventions

Follow the [[agents|root guide]] for every convention not specific to people. This guide
adds only person selection and shape.

## Suggested shape

A person can use a recognizable kebab-case folder, commonly
`people/<first-last>/`:

    people/<person-slug>/
    ├── intro                  — who they are and how the owner knows them
    ├── timeline               — material relationship and relevance milestones
    ├── contacts               — useful ways to reach them
    ├── work                   — roles, companies and things they have built
    └── as-<relationship>      — the owner's view in one relationship context

Most people need only `intro`. An aspect earns its own page when it is useful to read or
maintain independently:

- **`contacts`** contains supported contact details and useful location facts.
- **`work`** contains roles and companies over time, notable work and relevant
  professional background.
- **Lens pages** use `as-<relationship>` when the owner's view depends on a particular
  context.
- **`timeline`** contains material interactions and dated changes that explain the
  relationship or why the person is relevant.

Conversation-useful context such as what someone cares about can stay in `intro` or the
relevant relationship lens. Add another aspect only when its subject becomes
independently useful, and name it for that subject.

## When a person is useful

A person folder is useful when the owner has a material relationship or interaction
with them, or when the person is important to a real decision, introduction, project or
sustained interest. A passing name, peripheral attendee or unengaged correspondent does
not need a speculative stub.

Create the entity when the person is clearly identifiable and the page will be useful
again. Usually this means a supported name plus enough context—such as company, role,
profile, contact detail or specific interaction—to distinguish them from plausible
namesakes and existing aliases. No fixed checklist of identifiers is required. A lone
display name, email address, handle or participant-list entry is insufficient when it
still leaves genuine doubt.

## Example intro

    # <Name>                                        ← intro

    **How the owner knows them:** one line.

    Why this person matters here, with links to the useful aspects.

    **Timeline:** [[people/…/timeline|Relationship history]].

    ## Notes
    What is worth knowing before another interaction.

Omit the `Timeline` link from `intro` until a timeline page is useful enough to exist.

The timeline is for material interactions and changes, not every contact. Record a
meaningful change in what the person is doing—such as starting a role, company or
project—as a dated milestone instead of keeping an undated “currently” snapshot in
`intro`. `work` can hold the fuller role history without duplicating the milestone.
Follow the root contract to keep a milestone and its diary evidence synchronized.

Keep judgements specific, relevant to the owner's relationship and grounded in
something that happened. Write with the care appropriate to a real person.
