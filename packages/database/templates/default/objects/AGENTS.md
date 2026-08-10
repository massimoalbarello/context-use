# Objects conventions

Follow the [[agents|root guide]] for every convention not specific to physical objects.
This guide adds only object selection and shape.

`objects/` is for particular physical things whose identity or history matters over time: a
specific car, computer, camera, instrument or heirloom. It is not a product catalogue or an
inventory.

## Suggested shape

    objects/<object-slug>/
    ├── intro          — what this particular object is and why it matters
    ├── specifications — useful durable technical facts
    ├── maintenance    — the canonical care and service record
    └── timeline       — material events in the object's history

Use the name the owner would recognize, adding a model, year or nickname only to
disambiguate the instance. `intro` is often enough.

## When an object is useful

An object page is worthwhile when the particular instance has continuing relevance: it is
repeatedly used, maintained, repaired, modified, insured, transferred, strongly valued or
linked from several meaningful contexts.

A generic product, disposable item or passing purchase does not become an object page. If
the owner recounted it, climb to the topic that covers it under the root rule for
[[agents#which-entity-does-it-belong-to|choosing the entity]]; if it merely appeared in a
harvested record, leave it in the account that mentioned it.

## Example intro

    # <Recognizable name>                          ← intro

    **What:** make / model / kind.
    **Associated with:** [[people/…|Person]] or [[companies/…|Company]], when useful.

    Why this particular instance matters and the minimum context needed to recognize it.

Object timeline events include acquisition, material repair, modification and transfer, and
any occasion the owner recounts involving this particular thing.

Ownership, use and preference are relationships with a person, so the relevant person page
states them and links the object. Serial, registration, tracking and insurance numbers are
the sensitive identifiers the root privacy rule governs here.
