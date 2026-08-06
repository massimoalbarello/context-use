# Objects conventions

The `objects/` directory holds individually meaningful physical things whose identity
or history matters over time: a particular car, computer, camera, instrument, heirloom
or other durable object. It is not a product catalogue or an inventory of everything
someone owns.

## Structure

One folder per object at `objects/<meaningful-slug>/`, entered through `intro`, as
[[agents#entities-are-folders-and-views-are-pages|every entity is]]. Name the specific
thing as the owner would recognize it. Add a disambiguating model, year or nickname only
when needed; never put a registration number, serial number or other sensitive
identifier in a path.

    objects/<object-slug>/
    ├── intro          — what this particular object is and why it matters
    ├── specifications — durable technical facts that are actually useful
    ├── maintenance    — the canonical care and service record
    └── timeline       — material milestones in the object's history

`intro` is required. Every other page is optional and exists only when it has durable
content that would make `intro` unwieldy.

## When to create one

Create an object only when the particular thing has continuing relevance independent of
the sentence that mentioned it: it is used repeatedly, maintained, repaired, modified,
insured, transferred, strongly valued or linked from several parts of the knowledge
base.

Do not create an object for a generic product, a disposable item, a passing purchase or
every gadget someone happens to mention. A person's taste or favourite gadget belongs
on that person's relevant aspect page; link an object only when the particular thing
also meets this directory's threshold.

## Template

    # <Recognizable name>

    **What:** make / model / kind — *as of <date where relevant>*.
    **Associated with:** [[people/…|Person]] or [[companies/…|Company]], when useful.

    Why this particular object matters and the minimum context needed to recognize it.

    # Timeline                                      ← optional timeline

    ## 2026
    - **28 July** — [[about/diary/…|Repaired after the trip]] — replaced the
      failed alternator; the durable maintenance detail is in [[objects/…/maintenance|maintenance]].

The timeline follows [[agents#durable-pages-and-the-diary|the root rule]]: descending
years, newest first, acquisitions, material repairs, modifications and transfers, each
linking the canonical event, meeting, diary entry or maintenance page rather than
duplicating it. Omit routine use.

## Local rules

- **One folder means one particular object.** Facts about a product line or technology
  belong with the external work or other subject that discusses them unless a specific
  owned or used instance matters here.
- **Relationships are links.** Ownership, use and preference concern a person; record
  them on the relevant person or owner page and link this object. Do not maintain an
  exhaustive list of everyone who has touched it.
- **Dated history, never a to-do.** The timeline and maintenance record say what
  happened and when — never that a repair is waiting, who owns the next action or what
  happens tomorrow; that stays in the diary.
- **Minimize sensitive identifiers.** Never store credentials, access codes or recovery
  secrets. Record serial, registration, tracking or insurance identifiers only when the
  owner explicitly needs them here, and never expose them in titles, paths or summaries.
