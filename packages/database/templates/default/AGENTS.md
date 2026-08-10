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
- [[topics/agents|Topics]]

### Managed pages

- [[automations/activity-distiller/instructions|Activity distiller instructions]] —
  maintained by the default template.
- [[automations/activity-distiller/state|Activity distiller state]] — created by the
  template when absent, then owned by the automation.
- [[automations/diary-composer/instructions|Diary composer instructions]] — maintained by
  the default template. The only writer of the diary.
- [[automations/diary-composer/state|Diary composer state]] — created by the template when
  absent, then owned by the automation.

The links identify the guide or page that owns each convention. They do not imply a
schema beyond what the linked guide says.

## Keep only what matters

Keep the smallest account that preserves what is useful to the owner: the facts, dates,
evidence, rationale, uncertainty and connections needed to understand the subject. The
context in which the owner interacted with a subject is the best signal of what matters;
a canonical page is not an encyclopedia entry or a container for every available fact.

Brevity governs how much is written about a subject, never how many of the owner's
subjects are represented. Each page stays short; the base still covers everyone the owner
dealt with and everything they decided. A base that answers "what happened" but not "to
whom, at which company, about which question" is not concise, it is missing its subjects.

- Prefer the fewest coherent pages, each no larger than useful. Split a page only when
  its parts have distinct subjects or are independently worth retrieving.
- Prefer several small linked pages over one page that absorbs its neighbours' subjects.
  A paragraph about a person, company or question inside someone else's page is a page
  that has not been written yet.
- Give every page a one-sentence summary; directory indexes and search use it.
- Link to canonical context instead of restating it. Say a thing once, where it belongs.
- Connect what happened, who or what was involved, what preceded it and what followed.
- Remove empty headings and scaffolding. A common template is a vocabulary, not a quota.
- Distinguish observation, report and inference. Do not turn a suggestion into the
  owner's view or fill a gap merely to make a page look complete.
- When a page speaks as the owner, use first person and ground it in what they expressed;
  label inference rather than silently turning it into their memory, motive or position.

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

The owner's own engagement is the general threshold for a canonical page. Someone they
met, wrote to or heard from; an organization they evaluated, decided about, worked with
or transacted with; a question they took a position on — each is part of what the owner
did, and earns its page the first time it happens rather than after it repeats. A name
that appears only inside someone else's account, with no engagement by the owner, stays
plain text under the page that mentioned it. Each directory guide says what engagement
means in its subtree and may narrow the threshold for its own kind of subject; none of
them replaces it with a requirement to wait for repetition.

Identity is decided by evidence, not by resemblance. Two people who share a given name,
or two organizations that share a first word, are two entities until something in the
evidence actually joins them; merging them silently destroys knowledge that separate
pages would have kept. When a source marks its own references with a stable identifier or
path, treat matching markers as the same entity and differing markers as different ones,
whatever the visible labels do.

Every entity is a folder, entered through `intro`; other pages in that folder are views
of the same entity. There are no flat entity pages: an entity that currently needs only
one page is still a folder, so a later view or a `timeline` can be added without promoting
the page and repairing its inbound links first. The owning directory guide defines the
further useful views and the evidence required to create the entity.

Add the `timeline` when there is a timeline event to record, not before; an empty one is
scaffolding. Someone the owner knows, with nothing yet that happened on a day, is a
complete entity with an `intro` alone. An occurrence never takes one at all: a meeting or
event already happened on its own date, so its page is its account and a timeline beneath
it would index a single timeline event that is the page itself.

`intro` is the entry point in fact and not only in name: every other page in the folder is
reachable from it, through the sentence that says what that view holds. A `timeline`, lens
or fact page nothing links to is unreachable from the entity it belongs to, and a reader
arriving at the entity will never learn it exists.

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

## Three homes

Durable pages explain their subjects; the [[about/diary/agents|diary]] records lived
chronology. Between them, what is known about an entity divides three ways, and putting a
fact in the wrong home is the most common way this base decays.

**What the subject is now** lives on the entity's pages. It is written to stay true as
weeks pass, and it is corrected in place when later evidence shows it wrong. Page history
preserves the replaced wording, so a live page never has to carry a superseded claim.

**What happened, and when** lives on the entity's `timeline`, one line for each.

**A past state that is independently worth reading** earns its own page in the folder,
linked from `intro` and from the timeline event that marks the transition.

The choice between the last two is whether anyone would read the old state for itself. A
project's earlier iteration would: it had its own shape, and the account of it is still
worth reading. A filing deadline that turned out to be wrong would not — the whole of its
value is one line saying it was wrong and why.

The test for the first is whether a sentence will still be true in three months.
*Combines satellite imagery with foundation models for carbon verification* will be.
*Moved into deeper diligence last week*, *reported $2.1M ARR in Q1*, *is leaning toward
passing* will not — each is an event with a date, and each belongs on the timeline.

The exception is a durable fact that can change: a role, a headquarters, an ownership
stake. That stays on the canonical page with an inline `— as of 27 July 2026`, and the
change itself earns a timeline event. That is the only kind of date a canonical page
carries. Relationships are durable and stay on it: who works there, who introduced whom,
which decision it belongs to. Moving a date off a page never takes its connections with
it.

## The timeline

A `timeline` records what the owner did, experienced or learned involving its entity,
dated to when it happened — not only what materially changed about the subject itself.
Each line on it is one **timeline event**. Descending year headings, descending month
headings within them, newest first:

    ## 2026

    ### August

    - **9 August** — [[places/…|Da Enzo]] — dinner here; best carbonara I have had in Rome.

    ### July

    - **28 July** — [[meetings/…|Partner review]] — agreed to pass on the round.

A timeline event is a line, never a page, and it is not an [[events/agents|event]] in the
`events/` sense — an occasion with its own folder, such as a conference, trip or wedding.
A timeline event may link one of those; it never becomes one. Keep the qualifier: bare
"event" in this base means the page, not the line.

One timeline event is one line: the date, the links that place it, and what happened. One
wanting a paragraph is describing either the current state or a past state worth reading,
and belongs on a page under the rule above. Keep the month in the line as well as the
heading, because these lines are read away from their page — quoted into a day's log,
returned by search — and a line that does not say its own date is useless there.

Never link the diary from a timeline event. The date is already the link: a day's log
is always at `about/diary/<YYYY>/<MM>/<DD>/log`. Writing it out asserts a page that
usually does not exist yet, because the diary is composed afterwards by
[[automations/diary-composer/instructions|the diary composer]], which reads timelines and
links back to the entities it finds there. Nothing else writes the diary, and an agent
recording a timeline event should not try.

Date a timeline event to when the thing happened, which is not always when it was written.
An old project written up today, a book finished years ago and a conference attended last
week each take their own date. Dating one into the past creates no diary day in the past;
the composer files the act of writing under the day it was written.

When a timeline grows unwieldy, promote it to `timeline/<YYYY>` pages and repair inbound
links in the same coherent change. Most entities never need this.

Correcting a timeline event is ordinary reconciliation: fix the claim where it appears
and leave the surrounding lines as contemporaneous record.

## Which entity does it belong to

Anything the owner says is worth recording, because they chose to say it. The selection
thresholds in this base exist for harvested sources, which arrive by the thousand and are
mostly noise; they are not a filter on the owner's own account of their day.

So the question is rarely whether to record something. It is which entity it belongs to.
Name the most specific entity the evidence actually identifies, and climb until you reach
one it does. A named dish at a named restaurant identifies both. A photograph of a meal
with no place and no name identifies neither, and a topic such as `topics/food` is what
the evidence supports. Climbing is the safe direction: a coarse entity can be split later,
once repeated timeline events give one of its parts a subject of its own, whereas a specific
entity invented on a guess produces near-duplicates that no evidence will ever merge.

A subject that is not a person, organization, place or occurrence is usually one of three
things, told apart by how it sits in time. An enduring aspect of the owner's life or
thinking, with no start and no finish, is a [[topics/agents|topic]]: how they eat, how they
train, a lens they apply, a principle they hold. A finite pursuit that can resolve or close
is a [[about/tasks/agents|task]]. A body of work large enough that it breaks into several
such pursuits is a [[about/projects/agents|project]].

Read the page rather than its name. Something called *founder feedback during diligence*
sounds like an episode inside one diligence, but if what it records is the rule the owner
applies every time, it has no start and no finish and it is a topic. Names follow content
here; content never follows a name.

A topic is therefore the holding area for activity that has not yet individuated. It
accumulates timeline events until a dish, a place or a practice has enough history to be
worth retrieving on its own; that part then becomes its own entity and its events move
there.
Day logs written before the split keep pointing at the topic, which is where the
material lived at the time. A long topic timeline is the expected shape and the signal to
split, not a defect — and for this class `intro` is thin at first, distilled from the
timeline as it accumulates rather than known in advance the way a company's is.

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

The same rule governs relationships between pages. Put the wikilink on the sentence that
explains the relationship, never in a `Connections`, `Related` or `See also` list at the
end. Such a list asserts that two subjects are connected without saying how, and generated
directory indexes already provide navigation. If a relationship is worth recording, it is
worth a sentence saying what it is.

### Name a subject once, as a link

Every page names other subjects, and each of those names is either a link or a gap. The
first mention of a person, organization, place, work, topic, project, task or occurrence
that has a canonical page is a wikilink to it, in the sentence saying what it was to this
subject; later mentions on the same page stay plain so the prose reads. A subject counts
as mentioned however it is actually written — full name, given name, surname, initials, a
nickname, or a bare `the company`, `the conference`, `the project` — and the first of
those forms carries the link. Waiting for the canonical spelling is how a page names
someone four times without ever linking them.

Link the page that carries the account, not the folder around it: an entity is entered
through `intro`, so `[[area/…/intro|Name]]` lands a reader on what is known, while
`[[area/…|Label]]` names a collection and belongs only where the collection is itself the
subject. Both forms resolve, which is what makes mixing them easy and costly.

If a page names a subject that earns a canonical page under its own guide but does not
have one yet, the write is unfinished: create it in the same coherent change and link it.
Conversely, a page that links nothing is not yet placed — whatever the subject is to the
owner is itself a subject here, and the sentence saying so is where the link goes. Only
genuine doubt about identity justifies a plain name; doubt about whether a subject matters
enough is answered by the owning guide's threshold, not by omitting the link.

Never write a link to a page that does not exist. A wikilink is a claim that the target is
there, and one aimed at a path never created is a dead end for every reader who follows it
and a page that no later write knows is missing. The two halves are one decision: if the
subject earns a page, create it in this write and then link it; if it does not, name it in
plain text. Writing the link first and leaving the page for later is how both end up
undone.

Connection is mutual, and mutual connection is what makes this base crawlable: someone
arriving at any subject — a reader, or an agent following links for them — should reach
everything related to it by walking outward, without going back to search. So both ends
record a relationship. An occurrence names its participants and each participant's page
says what that occurrence was to them; an organization names the people the owner deals
with there and each of their pages names the organization; a subject that depends on,
displaced or competes with another says so from both sides. Watch for the shape where
every page links one or two hubs and nothing links sideways: it looks well connected and
is not, because every route between two related subjects runs through the hub. The links
worth adding are the ones between peers.

None of this is a reason to write fewer pages. It raises what a page must do, never how
many of the owner's subjects are represented: a subject that earns a page under its guide
gets one, and gets the sentence that connects it. Leaving a subject out because connecting
it looked like work is the failure these rules exist to prevent.

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
