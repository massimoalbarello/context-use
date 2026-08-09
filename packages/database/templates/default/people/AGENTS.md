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

Engagement under the [[agents#place-and-identify|root threshold]] means the owner and
this person were actually in contact or consequentially involved with each other. Any one
of these is enough, the first time it happens:

- they attended the same meeting, call or recurring one-to-one;
- either wrote to the other, or both took part in the same working conversation;
- the owner made or received a commitment, introduction or request involving them;
- they are a party to a decision the owner is making — a counterparty, a principal of the
  organization concerned, or the person whose work the decision rests on;
- they work alongside the owner day to day, which the shared channels of ordinary work
  already establish without any single notable exchange.

One such engagement earns the folder. Do not wait for a second, and do not weigh how
significant the person seems; a colleague the owner works with constantly is exactly the
kind of page that never gets written if importance has to be argued first.

A name that appears only inside someone else's message, an attendee list the owner did
not join, or a third-party account the owner merely read about is not engagement. Keep it
as plain text under the page that mentioned it, and create the folder the first time the
owner engages.

Identity, not importance, is the reason to hold back. Create the entity when the person is
clearly identifiable: usually a supported name plus enough context—such as company, role,
profile, contact detail or specific interaction—to distinguish them from plausible
namesakes and existing aliases. No fixed checklist of identifiers is required. A lone
display name, email address, handle or participant-list entry is insufficient when it
still leaves genuine doubt.

Shared given names are common and are not evidence of the same person. Two people with the
same first name, or the same surname, are two people until the evidence joins them, and a
source's own stable reference for a person outranks how closely the labels read. When one
display name genuinely stands for two people, say so on both pages rather than blending
them into one.

## Example intro

    # <Name>                                        ← intro

    **How the owner knows them:** one line.

    Why this person matters here, with links to the useful aspects.

    **Timeline:** [[people/…/timeline|Relationship history]].

    ## Notes
    What is worth knowing before another interaction.

Omit the `Timeline` link from `intro` until a timeline page is useful enough to exist, and
add it in the same write that creates one.

A person page says where they work, who introduced them or what they are working on, and
links each of those subjects. A person folder whose `intro` links nothing is a name in a
directory: it records that someone exists without connecting them to anything the owner is
doing, which is the one thing the folder was created to do.

The timeline is for material interactions and changes, not every contact. Record a
meaningful change in what the person is doing—such as starting a role, company or
project—as a dated timeline entry instead of keeping an undated “currently” snapshot in
`intro`. `work` can hold the fuller role history without duplicating the entry.

Keep judgements specific, relevant to the owner's relationship and grounded in
something that happened. Write with the care appropriate to a real person.
