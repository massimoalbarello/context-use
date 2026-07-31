# Events conventions

**One folder per event** at `events/<YYYY>/<MM>/<YYYY-MM-DD>_<slug>/`, entered through
`intro`, using the **start date** for anything spanning days. Multi-day events get one
folder, not one per day; a recurring conference gets one folder per occurrence, linked to
each other, rather than one page accumulating years.

    events/2026/06/2026-06-11_london-ai-summit/
    ├── intro        — what it was, where, why they went, what happened
    ├── takeaways    — what was actually got out of it
    └── (pictures)   — uploaded into the folder, embedded from either page

## Aspects

- **`intro`** — required. Written so it makes sense to someone who wasn't there.
- **`takeaways`** — what changed the owner's mind at the event, what they would do
  differently, and who became relevant and why. Split out because it is the part they
  come back for, and it should not be buried in an account of the schedule.

**Add any new name here** — `talks`, `notes` — so events stay comparable.

## When an event gets a folder

An event is a happening with a time and a place: a conference, a trip, a dinner, a
hackathon, a demo day, a wedding. Defined by the occasion, where a
[[meetings|meeting]] is defined by who was in it — so the event folder is not a container
for every conversation that happened inside it.

## Template

    # <Event> — <D Month YYYY>                    ← intro

    **What:** one line. **Where:** city, venue.
    **Why they went:** one line.

    ## What happened
    The parts worth remembering.

    ## People
    - [[people/…|Name]] — how they came up.

    # Takeaways                                   ← takeaways

    What changed in the owner's thinking at the event, what they would do differently,
    and what each of it turned into — linked to where it went.

## Local rules

- **Write what came of it, or don't write the folder.** An event page that only records
  attendance is a memory leak with a date on it. The value is in what followed.
- **Link existing people folders.** When an encounter makes a missing person materially
  relevant, propose all such folders together rather than silently creating them. An
  event is often where a relationship starts, and that origin is worth being able to
  find later.
- **Index material relationship milestones.** When something the owner did with a
  person or company at the event materially starts or changes that relationship, add one
  dated link to the entity's `timeline` in the same proposed write. Do not index mere
  co-attendance or copy the event account.
- **Anything durable that came out of it goes to its own home** — an idea to a project, a
  company to [[companies|companies]], a decision to the page that owns it — and the event
  links to it rather than restating it.
