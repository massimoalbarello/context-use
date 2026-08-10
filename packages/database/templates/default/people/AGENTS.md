# People conventions

Follow the [[agents|root guide]] for every convention not specific to people. This guide
adds only person selection and shape.

## Suggested shape

    people/<person-slug>/
    ├── intro                  — who they are and how the owner knows them
    ├── timeline               — material relationship and relevance events
    ├── contacts               — supported contact details and useful location facts
    ├── work                   — roles and companies over time, and notable work
    └── as-<relationship>      — the owner's view in one relationship context

Most people need only `intro`, commonly at `people/<first-last>/`. Add an aspect when its
subject becomes independently useful to read or maintain, and name it for that subject.

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

Do not weigh how significant the person seems; a colleague the owner works with constantly
is exactly the kind of page that never gets written if importance has to be argued first.
An attendee list the owner did not join, or a third-party account they merely read about,
is not engagement.

Identity, not importance, is the reason to hold back. What identifies a person here is a
supported name plus enough context — company, role, profile, contact detail or a specific
interaction — to distinguish them from plausible namesakes and existing aliases. A lone
display name, email address or handle is insufficient while genuine doubt remains, and
where one display name genuinely stands for two people, say so on both pages.

## Example intro

    # <Name>                                        ← intro

    **How the owner knows them:** one line.

    Why this person matters here, with links to the useful aspects.

    **Timeline:** [[people/…/timeline|Relationship history]].

    ## Notes
    What is worth knowing before another interaction.

Omit the `Timeline` link from `intro` until a timeline page exists, and add it in the same
write that creates one.

A person page says where they work, who introduced them or what they are working on, and
links each of those subjects. A person folder whose `intro` links nothing is a name in a
directory.

Record a meaningful change in what the person is doing — starting a role, company or
project — as a dated timeline event rather than an undated “currently” snapshot in `intro`.

Keep judgements specific, relevant to the owner's relationship and grounded in something
that happened. Write with the care appropriate to a real person.
