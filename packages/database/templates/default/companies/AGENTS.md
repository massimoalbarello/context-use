# Companies conventions

**One folder per company** at `companies/<slug>/` — lowercase, hyphenated — entered
through `intro`. Split a topic out as soon as `intro` starts having sections; don't let
one page become the whole company.

    companies/<company-slug>/
    ├── intro                 — what they are, and the links out
    ├── timeline              — material things the owner and company have done together
    ├── <fact-topic>          — a topic worth its own page
    └── as-<relationship>     — what they are to the owner in one context

## Aspects

**Fact pages** are named for their topic: `history`, `products`, `leadership`,
`locations`. **Lens pages** use `as-<relationship>` for the context in which the owner
relates to the company. Reuse an established name when it means the same thing in
another company folder; add genuinely reusable vocabulary to this guide when it emerges.

**`timeline`** is neither a fact page nor a lens page. It is the owner's material history
with the company, newest first: meetings, collaborations, transactions, purchases and
other direct interactions. Create it on the first such interaction; a
company known only through research does not need one.

The split survives because context changes and facts don't — a company may stop fitting
one relationship while becoming relevant in another, and only the lens pages should
need rewriting.

## When to create one

When a company becomes relevant to something real — a conversation, collaboration,
transaction, decision or sustained line of research. Not for every name mentioned.

An incidental affiliation or passing reference is not enough. Create the company only
when repeated or material relevance makes it independently useful; otherwise keep the
justified knowledge under its actual subject.

### Identity required for creation

A company page requires its canonical name and enough corroborating context to
distinguish the organization from similarly named companies and future duplicates.
Establish what it does and, when available, its official website or domain; retain other
supported identifiers such as relevant people, products, location or legal name in the
appropriate aspects. Search existing folders, aliases and linked people before creating
a new one.

A sender domain, email signature, logo, abbreviated name or passing mention is not
sufficient by itself. A domain is evidence, not automatic proof that the sender's
organization and the company being discussed are the same. If research leaves multiple
plausible companies, do not create the folder; ask the owner with the candidates and the
fact needed to distinguish them.

## Templates

    # <Company>                                    ← intro

    **What they do:** one line.
    **Stage / size / where:** — *as of <date>*.

    ## What they are        — fact pages, one line each
    ## What they are to me  — lens pages, one line each
    ## People

    # <Relationship context>                       ← lens page

    **Context:** [[about/tasks/…|the effort or decision this bears on]]

    ## Why this relationship matters — and what would change my mind
    ## What matters here      — the relevant strengths, problems and unknowns
    ## Connections            — links to relevant canonical pages, wherever they sit

    # Timeline                                      ← timeline

    ## 2026
    - **28 July** — [[meetings/…|Planning conversation]] with [[people/…|Name]] —
      agreed what each side would contribute to the next phase.

Use descending years and newest-first entries within each year. Each milestone links
the most specific meeting or event, or the diary page when no occurrence page exists,
and states only the durable outcome in one sentence.

## Local rules

- **Fact pages: facts, dated, nothing else.** No opinion or narrative; state uncertainty
  and sourcing plainly. A fact page with an opinion in it stops being trustworthy.
- **Write lens pages in the owner's first person**, from what they have actually said,
  and mark added reasoning as inference.
- **A lens page tracks no pursuit** — no status line, no next step. Whether they contacted
  the company, where an active conversation has got to, what they intend next week: none
  of that is about the company. Current movement goes in the [[about/diary|diary]];
  when it is part of a substantial effort, the durable frame belongs in
  [[about/tasks|about/tasks/]]. When something changes the view itself, edit the page to
  say what is now thought and let the diary hold what prompted it.
- **The timeline is completed history, not pursuit state.** Update it in the same
  proposed write as a meeting, event or diary entry that materially advances the
  relationship. It may record what was agreed then, but never whether it is still open,
  who currently owns it or what happens next; the diary owns that changing state.
- **Keep only one company chronology.** Company facts still belong on fact pages and the
  owner's judgement still belongs on lens pages. The timeline links their historical
  causes where useful instead of restating either account.
