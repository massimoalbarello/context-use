# Companies conventions

**One folder per company** at `companies/<slug>/` — lowercase, hyphenated — entered
through `intro`. Split a topic out as soon as `intro` starts having sections; don't let
one page become the whole company.

    companies/openai/
    ├── intro                — what they are, and the links out
    ├── timeline             — material things the owner and company have done together
    ├── memory-and-context   — fact page: a topic worth its own page
    ├── london               — fact page
    └── as-an-employer       — lens page: what they are to the owner

## Aspects

**Fact pages** are named for their topic: `funding`, `london`, `people`,
`memory-and-context`. **Lens pages**: `as-an-employer`, `as-a-customer`,
`as-a-competitor`, `as-an-investor`. **Add any new name to these lists**, so the same
thing is called the same thing in every company folder.

**`timeline`** is neither a fact page nor a lens page. It is the owner's material history
with the company, newest first: meetings, applications, partnership work, purchases,
investments and other direct interactions. Create it on the first such interaction; a
company known only through research does not need one.

The split survives because context changes and facts don't — a company ruled out as an
employer in 2026 may be a customer in 2028, and only the lens page should need
rewriting.

## When to create one

When a company becomes relevant to something real — a conversation, a candidacy, a
partnership, a competitor worth tracking. Not for every name mentioned.

## Templates

    # <Company>                                    ← intro

    **What they do:** one line.
    **Stage / size / where:** — *as of <date>*.

    ## What they are        — fact pages, one line each
    ## What they are to me  — lens pages, one line each
    ## People

    # As an employer                               ← lens page

    **Context:** [[about/tasks/…|the effort or decision this bears on]]

    ## Why they interest me   — and what would change my mind
    ## What matters here      — the relevant strengths, problems and unknowns
    ## Relevant roles         — links to their canonical pages, wherever they sit

    # Timeline                                      ← timeline

    ## 2026
    - **28 July** — [[meetings/…|Partnership call]] with [[people/…|Name]] —
      agreed the scope of a two-week technical evaluation.

Use descending years and newest-first entries within each year. Each milestone links
the most specific meeting or event, or the diary page when no occurrence page exists,
and states only the durable outcome in one sentence.

## Local rules

- **Fact pages: facts, dated, nothing else.** No opinion or narrative; state uncertainty
  and sourcing plainly. A fact page with an opinion in it stops being trustworthy.
- **Write lens pages in the owner's first person**, from what they have actually said,
  and mark added reasoning as inference.
- **A lens page tracks no pursuit** — no status line, no next step. Whether they emailed
  the company, where an application has got to, what they intend next week: none of that
  is about the company. Current movement goes in the [[about/diary|diary]]; when it is
  part of a substantial effort, the durable frame belongs in
  [[about/tasks|about/tasks/]]. When something changes the view itself, edit the page to
  say what is now thought and let the diary hold what prompted it.
- **The timeline is completed history, not pursuit state.** Update it in the same
  proposed write as a meeting, event or diary entry that materially advances the
  relationship. It may record what was agreed then, but never whether it is still open,
  who currently owns it or what happens next; the diary owns that changing state.
- **Keep only one company chronology.** Company facts still belong on fact pages and the
  owner's judgement still belongs on lens pages. The timeline links their historical
  causes where useful instead of restating either account.
