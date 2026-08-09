# Meetings conventions

Follow the [[agents|root guide]] for every convention not specific to meetings. This
guide adds only meeting selection and shape.

## Suggested shape and lifecycle

A meeting can use
`meetings/<YYYY>/<MM>/<YYYY-MM-DD>_<meeting-slug>/`:

    meetings/<YYYY>/<MM>/<YYYY-MM-DD>_<meeting-slug>/
    ├── prep        — background and questions prepared beforehand
    ├── intro       — the useful account after the conversation happens
    └── transcript  — exceptional raw source when no durable source survives

A confirmed future meeting may begin with `prep` alone; this is a lifecycle exception
to the root `intro` entry-point convention. `intro` becomes useful only after the
conversation happens, so do not create an empty one in advance. If the meeting is
cancelled, keep or archive the prep according to whether its research remains
independently useful. This supports preparation without pretending a future
conversation already occurred.

- **`prep`** holds only background, relationship context, useful unknowns and questions
  for this conversation. Leaving it in its pre-meeting form preserves what was known
  going in.
- **`intro`** distils what was said, what the owner concluded and any commitments made.
- **`transcript`** is reserved for a transcript that is the only record and whose source
  will not survive. Mark it as raw and still create a distilled `intro` when useful.

Photos, whiteboards and shared decks can sit in the folder and embed from the relevant
page.

## When a meeting is useful

A meeting folder is useful when forgetting the conversation would lose a meaningful
decision, insight, introduction, commitment or relationship milestone. Routine syncs
and purely administrative calls usually do not need one.

An [[events/agents|event]] is defined by its occasion; a meeting is defined by its
conversation. A conversation at an event can have its own meeting page when it matters
independently, with links between the two accounts.

## Distil the conversation

Prefer the useful account over a recording dump, transcript export or pasted raw notes.
Link a recording where it supports the relevant claim. Raw material otherwise makes
the important few paragraphs harder to retrieve.

    # <What it was> — <D Month YYYY>               ← intro

    **With:** [[people/…|Name]] ([[companies/…|Company]]) or <plain name> (<role, when useful>)
    **Where:** in person / call · **Why:** one line.

    ## What was said
    The substance, distilled rather than transcribed.

    ## What I took away
    The owner's conclusion or changed understanding at the time.

    ## Commitments made
    - What someone agreed during the meeting, stated as a historical fact.

An attendee is by definition someone the owner engaged with, so a clearly identified
attendee meets the [[people/agents#when-a-person-is-useful|people threshold]]: create the
person and link them from the `With:` line rather than naming them in plain text, in the
same write as the meeting itself. The same applies to the organization whose business the
meeting concerned, and to anyone named in a decision or commitment recorded here — an
introduction promised to someone is an engagement with that person.

Only genuine doubt about who an attendee is keeps them in plain text; an uncertain
participant-list entry can be omitted altogether. A meeting page whose participants are
all plain names records that a conversation happened and loses who the owner had it with.

Keep what another participant said distinct from what the owner concluded. A commitment
records what was agreed then; its later state follows the root timeline contract.

Index the meeting only where it is a material relationship milestone: for the relevant
identifiable people, and for a company when the conversation materially concerned the
owner's direct relationship with it. The linked meeting remains the full account. If a
write-up relies materially on delayed memory, say so.
