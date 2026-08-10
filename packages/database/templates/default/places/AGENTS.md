# Places conventions

Follow the [[agents|root guide]] for every convention not specific to places. This guide
adds only place selection and shape.

`places/` is for locations that matter as durable subjects: a home, venue, café, office,
neighbourhood, city or landscape that the owner returns to, makes decisions about or
connects to several meaningful parts of the knowledge base. It is not a gazetteer of
every location mentioned.

## Suggested shape

A place can use a recognizable kebab-case folder:

    places/<place-slug>/
    ├── intro       — what and where it is, and why it matters
    ├── practical   — durable access, travel or other useful details
    └── timeline    — material changes in the place's history or significance

Prefer the name people actually use and add a locality only when needed to
disambiguate it. `intro` will often be enough. Other aspects help only when they contain
independently useful material.

## When a place is useful

A place page is worthwhile when the location itself will be retrieved or linked again:
it is a home, recurring venue, favourite haunt, the subject of a decision or project,
or the setting for several meaningful occurrences.

A one-off occurrence can state its location directly. A city, restaurant or address
mentioned in passing need not become an entity until its repetition or significance
makes a canonical page useful. A place the owner recounts being at is not a passing
mention: under the root rule for
[[agents#which-entity-does-it-belong-to|choosing the entity]], a named venue they tell you
about is the most specific entity the evidence identifies, and it takes the event.

## Example intro

    # <Place>                                      ← intro

    **Kind:** home / venue / city / landscape.
    **Where:** locality and country; exact address only when genuinely useful.

    What makes this place independently relevant, without retelling the occurrences or
    relationships connected to it.

Place-specific timeline events include a move, renovation, opening, closure, a change in
significance, and an occasion the owner recounts here. Routine visits with nothing to
record stay on their occurrence pages. Follow the root timeline contract for dates and
canonical links.

A person's residence, favourite venue or other relationship with a place is a dated
fact about that person or the owner; state it there and link the place. The place page
does not need an exhaustive occupant or visitor list. Meetings, events and diary pages
remain the accounts of what happened there.

Use the least sensitive location that is still useful. Exact home addresses and access
instructions belong only in page bodies when genuinely needed, never in titles, paths
or summaries.
