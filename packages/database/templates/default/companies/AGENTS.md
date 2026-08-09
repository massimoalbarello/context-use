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

Name and link the people the owner actually deals with at the organization, in the
sentence that says what each of them does there. This is where someone looks to remember
who to talk to, and it is the edge that connects an organization to the rest of the base
instead of leaving it hanging off whichever occurrence created it. Only those people: the
page is not a staff directory, and someone the owner has never dealt with belongs on the
account that mentioned them.

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
An organization named only in passing inside someone else's account, with no dealing by
the owner, stays plain text under the page that mentioned it.

Create a canonical company only when its identity is clear enough to avoid a likely
duplicate. Its canonical name plus what it does may be enough; an official domain,
relevant people, products, location or legal name can supply further corroboration when
needed. A sender domain, signature, logo or abbreviated name is evidence, but not proof
on its own when several organizations remain plausible.

Organizations sharing a word are not the same organization. A common first word, a shared
family of names, or one being described as similar to another says nothing about identity;
what does is a shared domain, shared people, a stated relationship or a source's own
stable reference. Where several similarly named organizations appear, give each its own
page and say on each what distinguishes it, so the next mention can be placed correctly.
A single blended page is much harder to unpick later than two pages that turn out to be
one.

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
timeline records material company-relationship events under the root timeline contract,
one line each, and leaves the full account on the occurrence pages it links.
