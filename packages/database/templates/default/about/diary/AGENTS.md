# Diary conventions

The rest of this base holds durable accounts of their subjects. The diary holds the
owner's **present**: what they did, thought, decided and worried about on a given day.
Treat it as working memory — its job is to let a future agent answer *what are they
actually up to right now, and why*, then follow links outwards to the durable pages that
explain it and backwards to the days the work came from.

It is not a dump. Every entry is curated. If you are about to write something here that
has a better home, put it there and link.

## Structure

One folder per day at `about/diary/<YYYY>/<MM>/<DD>/`, segments zero-padded, with
exactly one entry point: `<DD>/log`. The day folder holds pages and assets belonging to
that day and nothing else.

**Day folders are created on write, never in advance.** A day when nothing happened has
no folder at all — an empty log is a memory leak with a date on it.

| Resource | Title |
| --- | --- |
| Year / month directory | `2026` · `July 2026` |
| Day directory | `Monday, 27 July 2026` |
| `log` page | `Log — Monday, 27 July 2026` |
| Other day pages | descriptive, date-suffixed |

The log's summary captures the day and is written **last**, from the finished entry.

## The log

    # Log — Monday, 27 July 2026

    *<Location> · one line framing the day*

    Narrative prose: what actually happened, what it felt like, what changed.
    Link durable things inline as they come up — [[about/projects/…|Project]],
    [[about/tasks/…|Task]],
    people, companies — rather than re-explaining them.

    ## On my mind
    - Short bullets. Thoughts, doubts, half-formed ideas, things being circled.

    ## Threads
    - [[about/projects/…|Project]] — what moved today · continues [[about/diary/…|24 Jul]]
    - [[people/…|Person]] — what happened between them

    ## Companion pages
    - [[about/diary/…|Title]] — one line (automation: `services-digest`)

Headings are stable — these names, in this order. Omit a section entirely rather than
leaving it empty, and don't invent top-level sections without a reason that generalises
to other days. Write in the owner's first person.

**Threads is load-bearing**: it is the day's edge list, outwards into durable knowledge
and backwards into the days this work came from. A day with no links is a warning sign,
not a finished entry.

## The placement rule

Before writing anything, ask: **will this still matter on its own in a month?**

- **No** → it belongs to the day: the log, or its own page in the day folder if it is
  long or structured.
- **Yes** → it belongs to a durable page elsewhere. Create or update that page, and let
  the log record *that it happened today*, with a link.

| Thing | Where it goes |
| --- | --- |
| How the day felt, a passing observation | the log |
| Working notes or a draft that only matter today | day folder page, linked from the log |
| A call, a conference, someone new, a company | the owning [[meetings/agents|meeting]], [[events/agents|event]], [[people/agents|person]] or [[companies/agents|company]] page; the log links, and a material relationship milestone is indexed on the entity timeline |
| A new idea, or a decision and its reasoning | the durable page for the subject; the log keeps the lived reasoning |
| A preference, taste, habit or belief articulated | a durable owner page, following the instance's organization under `about/` |
| An open loop still open tomorrow | the log links the durable subject, [[about/projects/agents|project]] or [[about/tasks/agents|task]] that gives it context; current state remains in the diary |

The log carries **pointers and lived texture, never canonical content**. A fact that
exists only inside a diary entry is trapped — the failure mode this directory exists to
avoid. When you find one in an older log, promote it: create or update the durable page,
then reduce the log line to a sentence and a link.

## Relationship timelines

When a day's entry records a material interaction with a person or company, create or
update that entity's `timeline` in the same proposed write. The diary owns what happened
that day and where things currently stand; the entity timeline merely makes the durable
relationship history findable from that entity.

- Link the canonical meeting or event when one exists; otherwise link the most specific
  diary page that records the interaction.
- Add one short, dated milestone saying what the owner and entity did together and what
  durably changed. Do not copy the account from its source.
- Do not add casual mentions, current status, pending commitments or next actions. A
  timeline is curated history; search remains the exhaustive occurrence list.

## Continuity

When a thread picks up work an earlier day already covered, link that page so an agent
reading today can retrieve the context instead of guessing at it.

- The link lives **on the Threads bullet**: `· continues [[about/diary/…|24 Jul]]`.
  Continuity belongs to the thread, not the day — one day can continue three things and
  start a fourth.
- **One hop back only**, to the most specific page — a meeting or a day page, not
  necessarily a log. Chains are traversed by following hops; repeating the ancestry in
  every entry is duplication and it rots.
- **Backwards only.** Never edit a past entry to add a "continued in" pointer. Past
  entries record what was known that day.
- **Only real continuation.** Mentioning the same subject two days running is not
  continuation; picking up where you left off is. A link meaning "this existed yesterday
  too" is noise, and noise is what makes the rest of the links untrustworthy.

**Continuity is not a substitute for a durable home.** If a chain runs past a week, or
you find yourself reading three logs to reconstruct the state of something, that thing
needs its own durable page — create one for the subject, [[about/projects/agents|project]]
or task frame and let the days link to it. Current state remains in the diary.

## Automations in the diary

The general contract is in [[automations/agents|automations]]. Inside a day folder:

- **One page per automation per day**, flat: `<DD>/<automation-slug>`, the slug stable
  across days so its history is findable by pattern. Title `<Automation name> —
  <D Month YYYY>`; summary about the activity on that date, not the pipeline run.
- **The date is when the activity happened, not when a source delivered it.** One run
  may create or revise several affected days. Delayed evidence belongs on its actual day.
- A multi-source activity distiller writes one coherent page for the day. It groups the
  owner's actions by their real project, task or other subject and links those canonical
  pages. Never create one diary page per connection, provider, repository or record.
- **A rerun rewrites its whole day page.** Reconsider its organization and wording in
  light of all evidence available for that day, remove duplication and superseded
  interpretations, and keep the result concise. Never append a run section or ingestion
  log. New evidence may justify correcting a past automation page in place.
- **Nothing to report, write nothing.** A filler page also materialises a day folder
  that had no reason to exist.
- An automation granted the log adds **one bullet under `## Companion pages`**, creating
  the section if absent. **Write access to the log is not permission to rewrite it** —
  the narrative, `On my mind` and `Threads` are the owner's. Change your bullet; leave
  every other byte as you found it. Re-running replaces that bullet, never adds a second.
  Never write another automation's page, even where scope would permit it.
- A `Continues [[…]]` line only where the recorded activity genuinely carries on earlier
  work — not because the automation ran before. That chain is derivable from the path.
- Checkpoints, cursors, record identifiers, run times, retry state and source diagnostics
  never belong in the diary. The automation's single `state` page owns its checkpoint.

## Reading and sweeping

- Start at today's `log` and walk back day by day; about a week is usually enough.
  Follow `continues` links rather than reading every intervening day — that is the point
  of them. Follow outward links for background: a log tells you *what happened*, the
  durable page tells you *what is true*.
- Logs are snapshots of a moment. Don't treat a mood, plan or open loop from an old
  entry as current without checking later days.
- **Weekly:** scan the last seven logs for anything mentioned twice or more. Repetition
  means it is durable — promote it and link back. A continuity chain that survived the
  week is the same signal.
- **Monthly, optionally:** `about/diary/<YYYY>/<MM>/overview`, narrating the month and
  recording what lasted. Never auto-generated; the point is the review.
- **Keep logs short.** A log is an index into a day with enough texture to remember it,
  not a transcript. Past roughly one screen means content is sitting in the wrong place.
  No raw dumps — no transcripts, email bodies, exports, credentials or keys.
- **Never delete or rewrite a past log to tidy up**, or to keep a chain neat. Correct it
  in place with a clear commit message, or record the correction in a later entry.

## Privacy

Publishing exposes ancestry: publishing any page here would make the diary's directory
titles, and that page's title and summary, publicly navigable. So a publishable summary
is written as its own day page — `<DD>/public-summary` — with a title and summary safe
to be seen, and only the owner publishes it. Assume everything else in a day folder
contains sensitive personal detail.
