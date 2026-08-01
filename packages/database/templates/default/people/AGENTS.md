# People conventions

**One folder per person** at `people/<first-last>/` — lowercase, hyphenated, the name
they actually go by — entered through `intro`.

    people/<first-last>/
    ├── intro                  — who they are and how the owner knows them
    ├── timeline               — material things the owner and person have done together
    ├── contacts               — how to reach them
    ├── work                   — roles, companies, what they have built
    └── as-<relationship>      — what they are to the owner in one context

## Aspects

`intro` is required and for most people is the only page. The rest are created when
there is something real to put in them — an empty stub is worse than a missing page,
because it makes the folder look answered.

- **`intro`** — who they are, how the owner knows them, one line on what they are doing
  now. Links to their company; never explains it.
- **`timeline`** — the relationship's material history, newest first. Create it for
  anyone the owner has interacted with; for a research-only person, wait until the first
  interaction. It links the canonical meetings, events and diary entries rather than
  repeating them.
- **`contacts`** — email, phone, handles and where they are based or live. Facts only;
  date changeable details and link a canonical [[places/agents|place]] when one meets
  that directory's durability threshold rather than copying its description.
- **`work`** — roles and companies over time, what they have built, what they are known
  for. Everything that would otherwise bloat `intro`.
- **`interests`** — durable preferences and recurring interests that are useful before
  another interaction, including favourite hangouts or gadgets. Link canonical place or
  object pages only when the particular entity independently meets its creation
  threshold; a passing preference stays as prose here.
- **Lens pages** — use `as-<relationship>` when the owner's judgement of the person
  depends on a particular context. Reuse an established name when it means the same
  thing elsewhere.

Anything else needs a name obvious to someone who has never opened the folder —
`family`, `writing`. **Add it to the list above when you use it.**

## When to create one

When the owner has actually interacted with someone, or when they are materially
relevant to something the owner is doing — someone central to a decision, someone they
were introduced to, or someone whose work matters to a sustained interest.

Not for a name mentioned in passing. An unfiltered contact dump makes the directory
useless for the thing it exists to do, which is saying who someone is right before the
next conversation with them.

For ingested activity, a participant field or one review/comment is still a passing
mention. Create the person only when repeated or material interaction makes the page
independently useful; otherwise link no speculative stub.

Before researching or creating a person, search for an existing folder and identify
which person is meant from the company, meeting, link, handle or other context the owner
provided. If two candidates survive, stop and ask with the detail that separates them.

## Template

    # <Name>                                         ← intro

    **How the owner knows them:** one line.
    **Currently:** <role> at [[companies/…|Company]] — *as of <date>*.

    A few sentences on who they are and why they matter here.

    **Timeline:** [[people/…/timeline|Relationship history]].

    ## Notes
    What is worth knowing before the next conversation — what they care
    about, what they are working on.

    # Timeline                                      ← timeline

    ## 2026
    - **28 July** — [[meetings/…|Introductory call]] — discussed working
      together; agreed on a concrete next step.

Use descending years and newest-first entries within each year. Each milestone says
what the owner and person did together and the durable outcome in one sentence. Link the
most specific canonical meeting or event; if none exists, link the diary page that
records it.

## Local rules

- **Occurrences link to people.** The person's `timeline` is the sole reverse index: it
  links back to material occurrences to make the relationship intelligible. Do not keep
  occurrence lists on other person pages, and do not turn the timeline into an exhaustive
  contact log; use search for that.
- **Update the timeline with the occurrence.** When creating or updating a meeting,
  event or diary entry that materially advances the relationship, include its timeline
  milestone in the same proposed write. Historical commitments may be named; current
  ownership, progress and next actions remain in the diary.
- **These are real people.** Keep judgements specific and grounded in something that
  actually happened. Nothing here should be embarrassing if the person read it. Any
  deliberately public-safe page still requires the owner's review before publication.
