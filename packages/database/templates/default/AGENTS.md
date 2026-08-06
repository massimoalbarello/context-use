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
  - [[about/projects/agents|Projects]] — enduring bodies of work the owner builds or
    stewards.
  - [[about/tasks/agents|Tasks]] — finite outcomes, experiments and decision frames.
- [[automations/agents|Automations]] — instructions and assets for external unattended
  workflows.
- [[companies/agents|Companies]] — company entities and the owner's context-specific
  views of them.
- [[events/agents|Events]] — occasions defined by a time and place.
- [[library/agents|Library]] — external works saved for recall.
- [[meetings/agents|Meetings]] — conversations worth preserving.
- [[objects/agents|Objects]] — individually meaningful physical things with durable
  identity or history.
- [[people/agents|People]] — the owner's personal CRM.
- [[places/agents|Places]] — locations that matter beyond a passing mention.
- [[skills/agents|Skills]] — reusable instructions loaded by an interactive agent.

The index tells you which guide governs a subject; the linked guide decides its actual
structure. Do not infer a directory schema from examples elsewhere.

## Organizing knowledge

- **The fewest coherent pages, each no larger than useful.** A page is the smallest unit
  worth reading, retrieving or linking on its own. Split one only when the parts have
  distinct subjects or are independently useful; never fragment knowledge merely to
  make pages short.
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

## Reconcile; never append by default

New evidence is a reason to reconsider the existing account, not to tack another block
onto its end. Before writing, read the canonical page and nearby pages that may overlap.
Then rewrite the whole affected account so the evidence fits its best current structure:
change headings, combine or separate claims, move material to its real subject, merge
duplicates, split an overgrown page, or archive a page that no longer earns its place.

Do not add `Updates`, repeated status snapshots or a chronological tail to a durable
page. Remove superseded wording and low-value detail; page versions preserve the prior
account and the diary preserves what happened. Creating a near-duplicate page because
editing the current one is harder is a failure.

Keep the result as concise as possible, but no more concise than the truth allows.
Dates, evidence, rationale, meaningful uncertainty and distinctions between observation,
report and inference survive compression. Reconciliation may leave a page unchanged
when the new evidence adds no durable value.

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

## Entities are folders and views are pages

**Anything with its own identity gets a folder.** A person, a company, a place, a
project, a task, a saved work, an object, a role applied for — if you would naturally
say *this thing* about it, it is an entity, and it lives at `<parent>/<slug>/` entered
through `intro`. Nesting never demotes one: something that exists inside a task, a
project or another entity is still an entity and still gets its own folder.

**A page is one view of the entity that contains it** — an aspect of it, a lens on it, a
chronology of it, or a document produced about it. Views carry no identity of their own;
each exists to say one thing about its folder.

    <parent>/<entity-slug>/
    ├── intro       — what it is; every entity has one
    ├── timeline    — its dated history, when it has one
    ├── <aspect>    — one page per view worth reading on its own
    └── <asset>     — files and documents belonging to this entity

Entities accumulate and views do not. Anything with identity eventually attracts a
second aspect, a document, an asset or a history, and a flat page has nowhere to put
them — so the next agent either grows one page past readability or invents a naming
scheme beside it. The folder costs one path segment today and absorbs all of that later.

The test when it is unclear: **could the subject be described without reference to its
container?** If it could, it is an entity and takes a folder, even when `intro` is the
only page it will ever hold. If it only means something relative to its parent — the
criteria for one search, notes on one aspect, a single document produced for it — it is
a view and stays a page.

**Promote rather than grow.** When an entity kept as a flat page needs a second view,
convert it into a folder with the existing page as `intro`, redirect inbound links in
the same write, and correct the directory guide that described it as a page. A directory
that deliberately keeps its entities flat has to say so in its own guide, and say what
promotes one; an undocumented deviation is exactly how a guide and its directory drift
apart.

## Durable pages and the diary

**The rule that keeps the base from rotting.** Every page outside the diary is a durable
account of its subject: it says what is true, or, for an occurrence, what happened. Edit
it in place when its canonical account changes; never turn it into a running update log.

Two things answer *where does this stand*, from opposite ends, and both reach the same
work:

- **The diary** is the only day-by-day chronology of the owner's life. Read the last few
  days to see what they are doing across everything at once, then follow its links
  outwards.
- **An entity's `timeline`** is that one entity's dated history: the states it has passed
  through, each linking the diary entry, meeting or event that holds the work itself.
  Read it to see where one thing stands without searching the diary for it.

Neither holds a mutable field. A change of state is written as a **dated entry** —
`**6 August** — applied, with the cover letter in this folder` — and the current state
is simply the most recent one, which stays true with nobody maintaining it. What is
forbidden everywhere, timelines included, is state with no date on it: a `Status:` line,
a "waiting on", a next step, an `Updates` section, a dated progress log on a page whose
job is to say what is true. Undated state is wrong the moment it stops being edited and
nothing says when that was. Dating a fact is not logging progress.

A `timeline` is optional and curated, never exhaustive. It carries the milestones that
make the entity's history intelligible — one dated line each, newest first under
descending years, adding only enough context to explain what changed, never restating
the page it links. Search remains the exhaustive record; an entity with no history worth
tracing has no timeline.

Every other page in the folder stays free of chronology. `intro` and the aspect pages
say what the entity *is*, and are edited in place to stay true.

When something happens, write it in the day's [[about/diary/agents|diary]] with links;
add a dated line to the entity's timeline if its state changed; then edit the durable
pages so they say what is now true. Versions hold the history; the diary holds why.

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
rewriting a page. Briefly explain why the proposed location and structure are the
cleanest fit under the applicable guides. One preview can cover a coherent set.
Unattended automations are the exception and follow their own
[[automations/agents|guide]].

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

## Referencing uploaded assets

Every uploaded asset is referenced with the image form, leading `!` included, whatever
the file actually is:

    ![Cover letter](context-use://asset/<uuid>)

The `!` is what makes it an asset reference. Without it nothing resolves the target and
the page renders the literal words `Private reference` where the file should be — the
most common way an asset reference is broken. Never write the plain link form
`[label](context-use://asset/…)`, never leave a bare `context-use://asset/<uuid>` in the
prose, and never paste a dashboard or download URL.

Presentation follows the asset's own content type, not the syntax. Images and videos
embed inline; every other type — PDFs and other documents — renders as a hyperlink
labelled with the bracket text. So a document needs a label that reads as a link:
`![Cover letter](…)`, not the raw filename and not `![](…)`, which falls back to a bare
`Open PDF`. An empty label is acceptable only on an image, where it is alt text.

The optional `{size=… align=… shape=… layout=…}` attributes apply to images and videos
only; they are ignored on a document, and one unrecognised key prints the whole brace
group verbatim on the page.

Copy the UUID from the asset's own reference field rather than retyping it. A UUID that
resolves to nothing renders as `Private reference` exactly like a missing `!`, so check
the rendered page rather than assuming the reference took.

An asset is published separately from the page embedding it, so a published page shows
`Private asset unavailable` wherever its asset is still private.

## Privacy

Private by default, and an agent cannot publish. Ask the owner to review and publish
anything that should be public. Publishing a page makes its directory ancestry navigable
publicly, exposing published titles and summaries. A deliberately public-safe page still
requires the owner's review before publication.
