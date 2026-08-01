# Places conventions

The `places/` directory holds locations that matter as durable subjects: a home, venue,
café, office, neighbourhood, city or landscape that the owner returns to, makes
decisions about or connects to several parts of the knowledge base. It is not a gazetteer
of every location mentioned in a meeting or diary entry.

## Structure

One folder per place at `places/<meaningful-slug>/`, entered through `intro`. Prefer the
name people actually use. Add a locality only to disambiguate similar names; avoid a
street address in the path.

    places/<place-slug>/
    ├── intro       — what and where it is, and why it matters
    ├── practical   — access, travel or other durable useful details
    └── timeline    — material changes or milestones associated with it

`intro` is required. Other aspects are created only when real content warrants them.
Use a specific, obvious name for any new aspect and add it to this guide when it should
be reused across places.

## When to create one

Create a place when the location itself will be useful to retrieve or link again: it is
a home, a recurring venue or favourite haunt, the subject of a decision or project, or
the setting for several meaningful occurrences.

Do not create a place for every city visited, restaurant named or address copied into a
meeting. A one-off occurrence can state its location directly. Promote the place when
repetition or durable significance makes a canonical page useful.

## Template

    # <Place>

    **Kind:** home / venue / city / landscape.
    **Where:** locality and country; exact address only when genuinely needed.

    What makes this place independently relevant, without retelling the meetings,
    events or relationships connected to it.

    # Timeline                                      ← optional timeline

    ## 2026
    - **28 July** — [[events/…|Moved in]] — began using it as a family home.

Use descending years and newest-first entries within each year. Include only changes or
milestones that make the place's history intelligible, linking their canonical pages.
Ordinary visits remain discoverable through search.

## Local rules

- **The relationship belongs with the person.** A person's residence, favourite hangout
  or connection to a place is a dated fact about that person or the owner; record it
  there and link the place. Do not maintain an exhaustive occupant or visitor list here.
- **The occurrence remains canonical.** Meetings, events and diary entries say what
  happened at a place. Its page supplies reusable place context and links only the
  milestones that materially changed its own history or significance.
- **Current progress remains in the diary.** A place timeline can record a completed
  move, renovation or closure, but never a live moving plan, pending repair or next
  action.
- **Use the least sensitive location sufficient.** Exact home addresses and access
  instructions are private and should appear only when the owner genuinely needs them;
  never expose them in titles, paths or summaries.
