# Knowledge base conventions

A durable hypermedia representation of the owner's life, work, interests and thinking.
Design it as though it will hold more than 100,000 pages.

This guide defines only conventions that apply everywhere. Each directory guide owns
the path shape, inclusion rules, aspect vocabulary and page templates for its area. Read
this guide, then every applicable guide from the root down to the target's parent before
writing.

## Guide index

- [[about/agents|About]] — knowledge whose subject is the owner.
  - [[about/diary/agents|Diary]] — chronological lived context and current state.
  - [[about/tasks/agents|Tasks]] — substantial efforts and decision frames.
- [[automations/agents|Automations]] — instructions and assets for external unattended
  workflows.
- [[companies/agents|Companies]] — company entities and the owner's context-specific
  views of them.
- [[events/agents|Events]] — occasions defined by a time and place.
- [[library/agents|Library]] — external works saved for recall.
- [[meetings/agents|Meetings]] — conversations worth preserving.
- [[people/agents|People]] — the owner's personal CRM.
- [[skills/agents|Skills]] — reusable instructions loaded by an interactive agent.

The index tells you which guide governs a subject; the linked guide decides its actual
structure. Do not infer a directory schema from examples elsewhere.

## Organizing knowledge

- **Many small pages over long ones.** A page is the smallest unit worth reading,
  retrieving or linking on its own. When one starts covering several subjects, split it
  and link the parts.
- **One canonical location per subject.** Links, never duplication, for anything that
  crosses the hierarchy. Never restate background that has its own page — anything
  written in two places is wrong in one of them within the year.
- **Every page needs a one-sentence summary.** Generated directory indexes and search
  results are built from them.
- **Connect, don't accumulate.** When something happened, who was involved, what preceded
  it and what followed — as links, not prose.
- **Say what was observed, what was reported, and what was inferred.** Never merge the
  three silently, and never upgrade a suggestion into the owner's position.
- **Date anything that changes** — roles, stages, headcounts, locations. Write
  `— as of 27 July 2026` inline; a fact with no date becomes a lie quietly.

## Where a page belongs

Place a page by its subject, not by the request that produced it or the person doing the
writing. Everything here touches the owner's life, so that alone decides nothing.

The check when it is unclear: **could this page be handed to someone else's knowledge
base and remain true?** If not, its subject is probably the owner. If it could, identify
the actual person, company, occurrence, saved work or other subject and follow that
area's guide from the index above.

Judgement stays with the subject being judged. Process, preference and intention stay
with the person whose thinking they describe. The owning directory guide defines how it
represents those distinctions; the root does not prescribe a page shape for them.

## Durable pages and the diary

**The rule that keeps the base from rotting.** Every page outside the diary is a durable
account of its subject: it says what is true, or, for an occurrence, what happened. Edit
it in place when its canonical account changes; never turn it into a running update log.
The diary alone is chronological and is therefore the **only place that says where
ongoing work currently stands**. Durable pages are overwritten; the diary is appended.

No status, next step, "waiting on", update section or dated progress log belongs on a
durable page. To find out where something stands, read the recent diary. Dating a fact is
not logging progress; what is forbidden is mutable state presented as durable truth.

When something changes, write what happened in the relevant day's
[[about/diary/agents|diary]] with links, then edit the durable page to say what is now
true. Versions hold the history; the diary holds why.

## Writing

Say a thing once, at the length it needs, and stop. Length is not thoroughness: a page
that cannot be skimmed has stopped being useful to whoever is deciding something from
it. Cut what restates a link's target, what hedges a claim already made, and what exists
to sound complete. Do not compress past meaning — a fact without its date, a judgement
without its reason or a claim without its source is shorter and worse.

On researched pages, relevance decides what stays. Keep what bears on why the subject
matters here plus the durable facts needed to identify it. Delete empty template
headings; never infer a fact merely to fill one.

## Citing sources

Sources are hyperlinks on the text making the claim, never a list of bare URLs at the
foot of a page.

    Good:   Announced in [June 2026](https://example.com/post), it ages out stale facts.
    Bad:    It ages out stale facts.
            ## Sources
            example.com/post (4 Jun 2026)

Any claim should be checkable from where it sits. If nothing in the text points at a
source, the source does not belong on the page. An unpublished source can be a link to
the relevant private page.

## Before writing: identify, propose, preview

**Identify.** Search for the canonical target before researching or writing. Names and
subjects collide; if more than one candidate survives, stop and ask with the details
that distinguish them.

**Propose.** Follow the owning directory guide for any related pages the write requires.
Present missing or ambiguous additions together in one question rather than creating an
unrequested cascade.

**Preview.** Show intended path, title, summary and full body before creating or
rewriting a page. One preview can cover a coherent set. Unattended automations are the
exception and follow their own [[automations/agents|guide]].

## Directories and guide layering

Every directory is linkable and its index is generated from its immediate children.
Never hand-maintain an `index` page; generated indexes are navigation, not a substitute
for authored overviews.

A directory guide lives at `<directory>/agents`, titled `AGENTS.md`. A child guide may
refine or extend its ancestors but must not copy them. The most specific applicable rule
wins when guides differ.

In a copyable Markdown example, write link targets as placeholders —
`[[area/…|label]]`, never a real path — because wikilinks resolve even inside fenced
code blocks. A target containing `…` or `<slug>` resolves to nothing and survives intact.

## Privacy

Private by default, and an agent cannot publish. Ask the owner to review and publish
anything that should be public. Publishing a page makes its directory ancestry navigable
publicly, exposing published titles and summaries. A deliberately public-safe page still
requires the owner's review before publication.
