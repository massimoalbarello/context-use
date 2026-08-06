# Companies conventions

Follow the [[agents|root guide]] for every convention not specific to companies. This
guide covers only company selection and shape.

## Suggested shape

A company can use a kebab-case folder at `companies/<company-slug>/`:

    companies/<company-slug>/
    ├── intro                 — what the company is and why it matters here
    ├── timeline              — material history between the owner and company
    ├── <fact-topic>          — an independently useful company fact
    └── as-<relationship>     — the owner's view in one relationship context

Most folders can remain a single `intro` page. Split out a topic only when it is useful
to retrieve or maintain independently, as described by the root guide.

## Company aspects

- **Fact pages** use a plain topic name such as `history`, `products`, `leadership` or
  `locations`. They describe the company rather than the owner's opinion of it.
- **Lens pages** use `as-<relationship>` for a context-dependent view of what the
  company is to the owner. This keeps a changing relationship separate from company
  facts.
- **`timeline`** contains only milestones in the owner's direct history with the
  company. Useful company-specific milestones include meetings, collaborations,
  transactions, purchases and relationship changes. Research alone usually does not
  call for a company timeline.

Reuse an established aspect name when it has the same meaning. Add a new aspect only
when its subject is independently useful.

## When a company is useful

A company folder is useful when the organization has material relevance to a
conversation, collaboration, transaction, decision or sustained line of research.
An incidental affiliation or passing name can remain a link or plain text under the
subject that made it relevant.

Create a canonical company only when its identity is clear enough to avoid a likely
duplicate. Its canonical name plus what it does may be enough; an official domain,
relevant people, products, location or legal name can supply further corroboration when
needed. A sender domain, signature, logo or abbreviated name is evidence, but not proof
on its own when several organizations remain plausible.

## Example pages

    # <Company>                                    ← intro

    **What they do:** one line.

    Why the company matters here, with links to any independently useful aspects.

    # <Relationship context>                       ← lens

    **Context:** [[about/tasks/…|the effort or decision this bears on]]

    ## Why this relationship matters
    ## What matters here
    ## Connections

Fact pages should distinguish supported fact from uncertainty. Lens pages use the
owner's expressed point of view; additional reasoning is labelled as inference. The
timeline indexes only material company-relationship milestones under the root timeline
contract and leaves the full account on its linked diary and occurrence pages.
