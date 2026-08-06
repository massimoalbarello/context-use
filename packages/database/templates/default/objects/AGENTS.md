# Objects conventions

Follow the [[agents|root guide]] for every convention not specific to physical objects.
This guide adds only object selection and shape.

`objects/` is for particular physical things whose identity or history matters over
time: a specific car, computer, camera, instrument or heirloom. It is not a product
catalogue or a complete inventory.

## Suggested shape

A recognizable kebab-case folder can hold the object:

    objects/<object-slug>/
    ├── intro          — what this particular object is and why it matters
    ├── specifications — useful durable technical facts
    ├── maintenance    — the canonical care and service record
    └── timeline       — material milestones in the object's history

Use the name the owner would recognize, with a model, year or nickname only when it
helps disambiguate the instance. `intro` will often be enough. Other aspects are useful
when their content deserves separate retrieval or maintenance.

## When an object is useful

An object page is worthwhile when the particular instance has continuing relevance:
it is repeatedly used, maintained, repaired, modified, insured, transferred, strongly
valued or linked from several meaningful contexts.

A generic product, disposable item or passing purchase usually belongs in the account
that mentioned it. A person's taste or preference belongs with that person; link the
specific object only when it is independently useful too.

## Example intro

    # <Recognizable name>                          ← intro

    **What:** make / model / kind.
    **Associated with:** [[people/…|Person]] or [[companies/…|Company]], when useful.

    Why this particular instance matters and the minimum context needed to recognize it.

Object-specific timeline milestones include acquisition, material repair, modification
and transfer; routine use does not help explain the object's history. Follow the root
contract for dates, diary synchronization and links to the canonical occurrence or
maintenance account.

Ownership, use and preference are relationships with a person, so the relevant person
or owner page should state them and link the object. The object page need not inventory
everyone who has used it.

Keep sensitive identifiers out of titles, paths and summaries. Serial, registration,
tracking or insurance identifiers belong in the body only when the owner actually needs
them there.
