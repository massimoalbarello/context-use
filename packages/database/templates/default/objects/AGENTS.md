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

## What identifies an object

The unit here is a **particular instance**, and that is what the
[[agents#identifiability-is-the-threshold|root threshold]] asks of the evidence: not that
the object matters, but that it resolves to one thing rather than a class of things. A
named boat, a specific car, the camera someone keeps repairing — each is identified. A model
name on its own is a product, not an instance, and identifies nothing here.

Where the evidence names a class, climb to the topic that covers it under the root rule for
[[agents#which-entity-does-it-belong-to|choosing the entity]] rather than inventing an
instance the evidence does not support.

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
