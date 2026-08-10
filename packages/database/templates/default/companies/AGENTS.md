# Companies conventions

Follow the [[agents|root guide]] for every convention not specific to companies. This
guide covers only company selection and shape.

## Suggested shape

    companies/<company-slug>/
    ├── intro                 — what the company is and why it matters here
    ├── timeline              — material history between the owner and company
    ├── <fact-topic>          — an independently useful company fact
    └── as-<relationship>     — the owner's view in one relationship context

Most folders remain a single `intro`. A **fact page** takes a plain topic name such as
`history`, `products` or `leadership` and describes the company rather than the owner's
opinion of it; a **lens page** uses `as-<relationship>` to keep a changing relationship
separate from those facts. Reuse an established aspect name when it means the same thing.

Name and link the people the owner actually deals with at the organization, in the
sentence that says what each of them does there. This is where someone looks to remember
who to talk to, and it is the edge that connects an organization to the rest of the base
instead of leaving it hanging off whichever occurrence created it. Only those people: the
page is not a staff directory.

## When a company is useful

Engagement under the [[agents#place-and-identify|root threshold]] means the organization
is something the owner is actually dealing with. Any one of these is enough, the first
time it happens:

- the owner employs, works for, or works inside it;
- it was the subject of a meeting, call or working conversation the owner took part in;
- the owner is evaluating, negotiating with, buying from, selling to, investing in or
  partnering with it, or has decided not to;
- the owner corresponds with its people about its business;
- it is the affiliation of someone the owner engages with, and that affiliation matters to
  why they engage.

One such engagement earns the folder, before the relationship has any history to record.

What identifies an organization here is its canonical name plus what it does, corroborated
where needed by an official domain, relevant people, products, location or legal name. A
sender domain, signature, logo or abbreviated name is evidence, not proof, while several
organizations remain plausible. What actually joins two similarly named organizations is a
shared domain, shared people, a stated relationship or a source's own stable reference;
where several appear, give each its own page and say on each what distinguishes it.

## Example pages

    # <Company>                                    ← intro

    **What they do:** one line.

    Why the company matters here, with links to any independently useful aspects.

    # <Relationship context>                       ← lens

    **Context:** [[about/tasks/…|the effort or decision this bears on]]

    ## Why this relationship matters
    ## What matters here

Fact pages distinguish supported fact from uncertainty. Lens pages use the owner's
expressed point of view, labelling additional reasoning as inference. Company timeline
events include meetings, collaborations, transactions and relationship changes; research
alone usually does not call for a timeline.
