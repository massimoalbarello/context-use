# Events conventions

Follow the [[agents|root guide]] for every convention not specific to events. This guide
adds only event selection and shape.

## Suggested shape

An event can use its start date at
`events/<YYYY>/<MM>/<YYYY-MM-DD>_<event-slug>/`:

    events/<YYYY>/<MM>/<YYYY-MM-DD>_<event-slug>/
    ├── intro        — what it was, where, why the owner went and what happened
    ├── takeaways    — what changed or became useful because of it
    └── (pictures)   — assets embedded from the relevant page

A multi-day event is one occurrence and usually one folder. A recurring conference has
one folder per occurrence, linked across years, rather than one page that mixes them.

`intro` should make the occurrence intelligible to someone who was not there.
`takeaways` is worth separating only when the owner's changed thinking, follow-through
or new connections are independently useful to revisit. Names such as `talks` or
`notes` should have an obvious event-specific purpose and be reused consistently.

## What counts as an event

An event is defined by an occasion with a time and place: for example, a conference,
trip, dinner, hackathon, demo day or wedding. A [[meetings/agents|meeting]] is instead
defined by the conversation and participants. A meaningful conversation inside an
event may have its own meeting page, but the event is not a container for every
conversation that occurred there.

An event page earns its place when it preserves something useful beyond attendance:
what happened, what the owner took from it, or what it led to. A passing calendar entry
or an occurrence with no durable significance can remain in the diary or source system.

## Example pages

    # <Event> — <D Month YYYY>                     ← intro

    **What:** one line. **Where:** city, venue.
    **Why the owner went:** one line.

    ## What happened
    The parts worth remembering.

    ## People
    - [[people/…|Name]] — why this person mattered to the event.

    # Takeaways                                    ← takeaways

    What changed in the owner's thinking, what they would do differently and what the
    event led to, linked to the canonical pages where those outcomes now live.

Link only people and companies that are clearly identified and useful to understanding
the event. When an encounter materially starts or changes a relationship, it can become
a milestone in that entity's timeline under the root contract; co-attendance alone is
not a milestone. The event remains the account of the occurrence, while durable outputs
live with their own subjects and link back here.
