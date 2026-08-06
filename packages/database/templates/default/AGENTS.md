# Knowledge base conventions

This knowledge base is a durable hypermedia representation of the owner's life, work,
interests and thinking. Design it to remain useful beyond 100,000 pages.

This root guide contains only conventions that apply everywhere. A directory guide adds
the few rules specific to its subtree. Before writing, read this guide and each guide on
the path to the target; do not repeat inherited guidance in a child.

## Guide and managed-page index

### Guides

- [[about/agents|About]]
  - [[about/diary/agents|Diary]]
  - [[about/projects/agents|Projects]]
  - [[about/tasks/agents|Tasks]]
- [[automations/agents|Automations]]
- [[companies/agents|Companies]]
- [[events/agents|Events]]
- [[library/agents|Library]]
- [[meetings/agents|Meetings]]
- [[objects/agents|Objects]]
- [[people/agents|People]]
- [[places/agents|Places]]
- [[skills/agents|Skills]]

### Managed pages

- [[automations/activity-distiller/instructions|Activity distiller instructions]] —
  maintained by the default template.
- [[automations/activity-distiller/state|Activity distiller state]] — created by the
  template when absent, then owned by the automation.
- [[automations/guideline-consistency-review/instructions|Guideline consistency review
  instructions]] — maintained by the default template.

The links identify the guide or page that owns each convention. They do not imply a
schema beyond what the linked guide says.

## Keep only what matters

Less is more. Keep the smallest account that preserves what is useful to the owner:
the facts, dates, evidence, rationale, uncertainty and connections needed to understand
the subject. The context in which the owner interacted with a subject is the best signal
of what matters; a canonical page is not an encyclopedia entry or a container for every
available fact.

- Prefer the fewest coherent pages, each no larger than useful. Split a page only when
  its parts have distinct subjects or are independently worth retrieving.
- Give every page a one-sentence summary; directory indexes and search use it.
- Link to canonical context instead of restating it. Say a thing once, where it belongs.
- Connect what happened, who or what was involved, what preceded it and what followed.
- Remove empty headings and scaffolding. A common template is a vocabulary, not a quota.
- Distinguish observation, report and inference. Do not turn a suggestion into the
  owner's view or fill a gap merely to make a page look complete.
- When a page speaks as the owner, use first person and ground it in what they expressed;
  label inference rather than silently turning it into their memory, motive or position.
- Date facts that can change, using an inline form such as `— as of 27 July 2026`.

## Place and identify

Place a page by its subject, not by the request that produced it or the person doing the
writing. If a page could be handed to someone else's knowledge base and remain true,
its subject is probably a person, organization, occurrence, work, place or other entity
rather than the owner. Judgement stays with the subject being judged; a person's own
process, preference and intention stay with that person.

Search for the canonical target across names, aliases and nearby context before writing.
When the evidence identifies a distinct entity confidently, create or update its
canonical page without asking for a preview or proposal. Start with the smallest useful
account and include only material supported by the interaction. If identity remains
genuinely ambiguous, do not guess or create duplicates: keep the reference in plain text
or ask for the detail that distinguishes the candidates.

Anything with durable identity is represented by a folder, entered through `intro`;
other pages in that folder are views of the same entity. The owning directory guide
defines the useful views and the evidence required to create the entity. If a flat page
later needs a second independently useful view, promote it to a folder and repair its
inbound links in the same coherent change.

Repeated attention across saved works, research and the owner's own pages can be
evidence that an entity matters, even without direct interaction. One passing mention
or saved work is not enough, and recurring attention never relaxes the owning guide's
identity threshold. Attention is not interaction and is not agreement: link the
attending evidence without inventing a relationship or adopting its claims as the
owner's view.

## Reconcile the canonical account

New evidence is a reason to reconsider the existing account, not to append another
update block. Read the canonical page and nearby pages that may overlap, then make the
smallest coherent change: rewrite, reorder, combine, move, split, merge or archive as
needed so there is one concise current account.

Preserve useful information, including meaningful historical context. Rewrite or remove
claims that later evidence shows to be wrong or misleading; those claims do not become
valuable merely because they were written first. When a mistaken belief is itself useful
history, label it as what was believed at the time and connect it to the correction.
Versions retain replaced wording, so the live page need not preserve superseded prose.

Do not append `Updates`, repeated snapshots or chronological tails to a canonical page.
Reconciliation may leave a page unchanged when new evidence adds no durable value.

## Diary and entity timelines

Durable pages explain their subjects. The [[about/diary/agents|diary]] records lived
chronology, including current activity and why it matters. A durable entity may also
have a `timeline`: a concise, dated index of the material events and state changes that
make its history intelligible. It is not an exhaustive activity feed.

A useful common shape uses descending year headings and newest-first entries within
each year:

    ## 2026
    - **28 July** — [[about/diary/…|Diary entry]] · [[area/…|Occurrence]] — what
      materially changed.

Omit the occurrence link when no canonical occurrence page exists.

For a material change recorded as it happens, keep the diary and entity timeline
synchronized in the same write:

- The diary account links the entity and any canonical meeting, event or other
  occurrence page.
- The entity timeline links the exact diary entry and, when one exists, the canonical
  occurrence page. It adds only a short statement of what materially changed.
- The date and factual claim agree across both directions; the detailed narrative lives
  in its canonical source rather than being copied into the timeline.

Historical milestones from before diary coverage link the best available source; never
invent a retrospective diary entry solely to satisfy the pattern. Casual mentions,
routine activity and repeated non-changes do not earn milestones. The latest relevant
milestone should make a major state change—such as starting, changing direction,
handover, completion or resolution—easy to find, while transient status and next actions
remain in the recent diary.

When correcting a timeline event, check its linked diary and occurrence pages in the
same pass. Correct wrong or misleading claims wherever they appear, preserve any useful
contemporaneous context, and keep the links and dates in agreement.

## Sources and links

Put a source link on the text that makes the claim, not in a list of bare URLs at the
end. An unpublished source can link to the relevant private page.

    Good: Announced in [June 2026](https://example.com/post), it ages out stale facts.
    Bad:  It ages out stale facts.
          ## Sources
          example.com/post (4 Jun 2026)

Use wikilinks for knowledge-base relationships. In copyable examples, use unresolved
placeholders such as `[[area/…|label]]`, because real wikilinks resolve even inside code
blocks.

## Write, then report

Make confident, in-scope writes directly. Afterward, tell the owner which pages were
created, materially rewritten, merged or archived and briefly why. Highlight newly
created entities so the owner can correct, remove or archive them if they are not useful.
Do not turn this report into a request for retroactive approval.

Ask before writing only when unresolved identity or scope would make a confident choice
unsafe. An unattended automation follows the same knowledge rules and the additional
operational contract in its [[automations/agents|guide]].

## Directories and guide layering

Every directory is linkable and its index is generated from its immediate children.
Do not hand-maintain an `index` page; generated indexes are navigation, not a substitute
for an authored overview.

A directory guide lives at `<directory>/agents`, titled `AGENTS.md`. Every child guide
links its direct parent guide and contains only local refinements. Inherited rules remain
in force without being copied; when a genuine local exception exists, the most specific
applicable guide wins and says so explicitly.

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

Knowledge is private by default, and an agent cannot publish it. Ask the owner to review
and publish anything intended for the public. Publishing a page makes its directory
ancestry navigable and exposes published titles and summaries, so even deliberately
public-safe material needs review before publication.

Never store credentials, access tokens, access codes or recovery secrets. Keep a
sensitive identifier or exact location only when it is genuinely useful to the owner,
and never expose one in a title, path or summary.
