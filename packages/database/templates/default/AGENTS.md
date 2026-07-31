# Knowledge base structure

A durable hypermedia representation of the owner's life, work, interests and thinking.
Design it as though it will hold more than 100,000 pages.

These rules apply everywhere and are stated only here. A directory's own `AGENTS.md`
adds what its name cannot imply — path shape, aspect vocabulary, templates, inclusion
criteria — and never repeats what is below. Read every guide from the root down to the
target's parent before writing.

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

Information whose subject is the owner goes under [[about|`about/`]], entered at
`about/intro`. External material saved for recall goes under [[library|`library/`]].
Other entities get top-level directories — `people/`, `companies/`, `meetings/`,
`events/` exist; add `places/` or other entity areas when needed.

## Where a page belongs

Everything here touches the owner's life, so that decides nothing. **Don't ask "would
this exist if not for them." Ask: are they the topic, or a participant?**

- **Topic** → `about/`: their past, what they built, their present, their substantial efforts and decision frames.
- **External work saved for recall** → `library/`: an article, video, podcast episode,
  paper, thread or other source, regardless of format.
- **Participant, or absent** → an entity directory. A meeting has them in it but is not
  about them.

The check when it's unclear: **could this page be handed to someone else's knowledge
base and remain true?** A meeting page would be nearly identical in any attendee's
notes; a page on what the owner wants from their next job would be meaningless in anyone
else's.

**Judgement about an entity stays with the entity** — it is still about them, seen
through a lens. So an entity folder holds two kinds of page: **fact pages** (what it is,
neutral and cited and true regardless of the owner) and **lens pages** (what it is *to*
the owner in one context — `as-an-employer`, `as-a-customer`, `as-a-cofounder` —
opinionated by design). Never mix them; never put two lenses on one page. What stays in
`about/` is the owner's **process, not their verdicts**: the criteria they judge by, the
intents they pursue.

## Durable pages and the diary

**The rule that keeps the base from rotting.** Every page outside `about/diary/` is a
durable account of its subject: it says what is true, or, for a chapter, meeting or
event, what happened in that occurrence. Edit it in place when its canonical account
changes; never turn it into a running update log. The diary alone is chronological and
is therefore the only place that says where ongoing work currently stands. Durable
pages are overwritten; the diary is appended.

**No status anywhere else** — no status line, no next step, no "Where it stands", no
"Updates", no dated notes stacking newest-first. This holds for `about/tasks/` too. To
find out where something stands, **read the recent diary**: by design nothing else will
tell you, so nothing else can be quietly wrong about it.

When something changes, write what happened in that day's [[about/diary|log]] with
links, then **edit the durable page to say what is now true**. Versions hold the
history; the diary holds why. Dating a fact is not logging progress — what is forbidden
is state.

## Writing

Say a thing once, at the length it needs, and stop. Length is not thoroughness: a page
that cannot be skimmed has stopped being useful to whoever is deciding something from
it. Cut what restates a link's target, what hedges a claim already made, and what exists
to sound complete. Don't compress past meaning — a fact without its date, a judgement
without its reason or a claim without its source is shorter and worse.

**On researched pages, relevance decides what stays**, because research is abundant and
free. Keep what bears on **what the owner is doing with this subject** — a call on
Thursday, a role they are weighing, a partnership — plus the durable facts that identify
it. A potted biography, a funding history nobody asked about, every role since
university, scraped marketing copy: all pass for substance and none is, and they bury
the two lines the owner would act on. Where a template heading has nothing real under
it, delete the heading; never infer a fact to fill it.

## Citing sources

**Sources are hyperlinks on the text making the claim** — never a list of bare URLs at
the foot of a page.

    Good:   Announced in [June 2026](https://example.com/post), it ages out stale facts.
    Bad:    It ages out stale facts.
            ## Sources
            example.com/post (4 Jun 2026)

Any claim should be checkable from where it sits. **If nothing in the text points at a
source, the source doesn't belong on the page** — delete it. Where a claim rests on
something unpublished, link the [[meetings|meeting page]] the same way.

## Before writing: identify, propose, preview

**Identify.** Names collide, and a page about the wrong person is worse than none:
silently wrong, linked, and never forced into correction. Before researching anyone,
search the base for an existing folder, then pin down which one is meant from what the
owner gave — the company, the meeting it came from, a link, a handle. If two candidates
survive, or the match rests on a common name, **stop and ask**, listing the candidates
and the detail that separates them. The right name at the wrong company is a different
person until shown otherwise.

**Propose the neighbours.** Entities arrive attached to others: a meeting brings its
participants and their employers, a person brings their company, an event brings the
people met there. Create what the occurrence cannot be written without — a meeting page
must link its participants — and for the rest, **name the missing ones in one question
and let the owner choose**:

> Added the meeting. No folders yet for Jane Doe or Acme — research and add either?

One batched question per request, never one per entity and never a silent cascade. An
entity that already exists is not a proposal, though a fact the new material contradicts
is worth flagging. Don't re-propose what was declined in the same conversation.

**Preview.** Show the page before it exists — intended path, title, summary, full body —
and write only once the owner confirms. New pages and rewrites alike; one message covers
a whole set. They amend at the preview, which is cheaper than a second edit and a
version nobody meant. Unattended automations are the exception
([[automations/agents|why]]).

## Entities

The owner's personal CRM, so any page can **link** to an entity instead of describing it
again. One conversation splits three ways: the conversation is a [[meetings|meeting]],
the person is in [[people|`people/`]], their employer is in [[companies|`companies/`]].
The meeting doesn't explain who the person is; the person's folder doesn't explain what
their employer does.

- **Every entity is a folder** with an `intro`, never a bare page, even for three lines —
  promoting `people/jane-doe` to `people/jane-doe/intro` later breaks every inbound link,
  and entities grow facets rather than paragraphs.
- **One aspect per page, named from the directory's vocabulary.** Each entity guide lists
  the aspect names it uses; pick from that list, and add to it when nothing fits. Left
  free, three sibling folders end up with `contacts`, `contact-info` and
  `how-to-reach-them`.
- **Naming.** Entities are slugs — `people/<first-last>/`, `companies/<slug>/`.
  Occurrences group by year and month and keep the full date in the leaf, so a link is
  unambiguous wherever it's pasted: `meetings/<YYYY>/<MM>/<YYYY-MM-DD>_<slug>/`, and the
  same for `events/`. The diary also groups by year and month, but its day leaf is
  simply `<DD>/`. Create the year and month directories first.
- **Create on first real relevance**, not speculatively. A directory of every name ever
  mentioned destroys the signal that a page exists at all.
- **Occurrences link to entities, never the reverse.** A person's folder keeps no list of
  their meetings; a list that needs maintaining stops being true. To find every meeting
  with someone, search.

Entity areas often hold personal detail about third parties. Keep them private by
default and never publish third-party personal detail. Only the owner may publish a
deliberately public-safe entity page after reviewing it.

## Directories, library, automations, skills

Every directory is linkable and its index is generated from its immediate children —
explore from the root down, and never hand-maintain an `index` page. Generated indexes
are navigation, not a substitute for authored overviews.

A directory guide lives at `<directory>/agents`, titled `AGENTS.md`. **In a copyable
Markdown example, write every link target as a placeholder** —
`[[meetings/…|label]]`, never `[[meetings|label]]` — because a wikilink resolves even
inside a fenced code block, so an example linking a real path renders as HTML instead of
the markdown it exists to demonstrate. A target containing `…` or `<slug>` resolves to nothing and survives intact.

[[library|The library]] holds one page per saved external work. Each entry links the
original, preserves what the owner said when saving it, and connects its people,
companies and ideas to their canonical pages rather than copying them.

[[automations|Automations]] run unattended in an external harness;
[[skills|skills]] are loaded by an agent working with the owner. Both file what they
produce by its subject, never by its author.

## Privacy

Private by default, and an agent cannot publish — ask the owner to review and publish
anything that should be public. Publishing a page makes its directory ancestry navigable
publicly, exposing published titles and summaries.
