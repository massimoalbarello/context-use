# Places conventions

Follow the [[agents|root guide]] for every convention not specific to places. This guide
adds only place selection and shape.

`places/` is for locations that matter as durable subjects: a home, venue, café, office,
neighbourhood, city or landscape the owner returns to, makes decisions about, or connects
to several meaningful parts of the base. It is not a gazetteer of every location mentioned.

## Suggested shape

    places/<place-slug>/
    ├── intro       — what and where it is, and why it matters
    ├── practical   — durable access, travel or other useful details
    └── timeline    — material changes in the place's history or significance

Prefer the name people actually use, adding a locality only to disambiguate. `intro` is
often enough.

## When a place is useful

A place page is worthwhile when the location itself will be retrieved or linked again: a
home, recurring venue, favourite haunt, the subject of a decision or project, or the
setting for several meaningful occurrences.

A one-off occurrence can state its location directly, and a city or address mentioned in
passing need not become an entity. But a place the owner recounts being at is not a passing
mention: under the root rule for
[[agents#which-entity-does-it-belong-to|choosing the entity]], a named venue they tell you
about is the most specific entity the evidence identifies, and it takes the event.

## Example intro

    # <Place>                                      ← intro

    **Kind:** home / venue / city / landscape.
    **Where:** locality and country; exact address only when genuinely useful.

    What makes this place independently relevant, without retelling the occurrences or
    relationships connected to it.

Place timeline events include a move, renovation, opening, closure, a change in
significance, and an occasion the owner recounts here. Routine visits with nothing to
record stay on their occurrence pages.

A person's residence or favourite venue is a fact about that person; state it there and
link the place. The place page needs no occupant or visitor list, and meetings, events and
day logs remain the accounts of what happened there.

Use the least sensitive location that is still useful. Exact addresses and access
instructions are the sensitive detail the root privacy rule governs here.
