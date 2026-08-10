# Diary conventions

This subtree inherits the [[about/agents|About conventions]]. The diary is the owner's
working memory: a curated day-by-day account of what they did, thought, decided and
worried about, with links to the durable subjects that explain it.

The diary is composed, not written alongside the knowledge it describes. An agent
recording something that happened puts it on the entity's `timeline` and stops there; the
[[automations/diary-composer/instructions|diary composer]] later reads the timelines that
changed and assembles the day from them. Nothing else writes a log. This keeps each writer
to one job, and lets a day be assembled once from everything in it rather than accreted by
whoever happened to write last.

The owner writes here directly whenever they want to. What they add is theirs, and the
composer preserves it.

## Structure

Use one folder per day at `about/diary/<YYYY>/<MM>/<DD>/`, with zero-padded path
segments and `<DD>/log` as the day's entry point. Create a day only when there is
something useful to record; do not pre-create empty folders or logs.

A day folder is a chronological container, not a durable entity. It therefore uses
`log` instead of the root `intro` convention; do not add a redundant `intro` page.

| Resource | Title |
| --- | --- |
| Year / month directory | `2026` · `July 2026` |
| Day directory | `Monday, 27 July 2026` |
| `log` page | `Log — Monday, 27 July 2026` |
| Other day pages | descriptive, date-suffixed |

The day folder contains only pages and assets belonging to that day. Give long or
structured day-specific material its own descriptive page and link it from the log.
Write the log summary last, from the finished log.

## The log

    # Log — Monday, 27 July 2026

    *<Location> · one line framing the day*

    Narrative prose about what happened, what it felt like and what changed, with
    durable subjects linked inline.

    ## On my mind
    - Short thoughts, doubts and half-formed ideas.

    ## Threads
    - [[about/projects/…|Project]] — what moved · continues [[about/diary/…|24 Jul]]

Keep these headings and order when the sections are useful; omit empty sections. The
narrative carries the lived texture and `Threads` is the day's edge list.

`On my mind` belongs to the owner. The composer never writes it and never infers a mood, a
doubt or a half-formed idea from what the pages happen to say. An interior state nobody
recorded is not recoverable from a timeline, and inventing one is worse than leaving the
section out.

Link every durable subject the day touched, and link the entity rather than its timeline:
a reader arriving at a day should be able to walk out to everything it involved. The log
says what happened and points at the subjects that explain it; the detail stays on them.

## Continuity

When work genuinely resumes from an earlier day, add one backward link on the relevant
`Threads` bullet: `· continues [[about/diary/…|24 Jul]]`.

- Link one hop to the most specific earlier page. Following the chain recovers older
  context, so repeating its whole ancestry is unnecessary.
- Do not edit an earlier log merely to add a forward pointer; it records what was known
  then.
- Repeated mention is not automatically continuation. Use the link only when work picks
  up where it left off.

A chain that becomes cumbersome is evidence that the subject may need a durable page,
project or task. Repetition is a signal to review placement, not proof that a new entity
or page is necessary.

## Reading and maintenance

- Start with today's log and work backward, usually about a week. Follow continuity
  links for active threads and outward links for durable context.
- Treat an old mood, plan or open loop as a historical snapshot until later logs
  confirm it.
- Periodically review recent logs for repeated or durable material that is difficult to
  retrieve from its subject. Promote only what earns a durable home.
- An optional `about/diary/<YYYY>/<MM>/overview` may narrate what mattered in the month;
  it is a considered review, not an automatic digest.
- Keep logs skimmable. Put transcripts, long drafts and structured material in an
  appropriate companion or canonical page.

Do not rewrite a past log merely to tidy its prose or make a link chain neater. Do
correct content that is wrong or misleading under the root reconciliation rule, while
preserving useful contemporaneous experience. When the correction itself matters to the
story, make it explicit and link the later evidence.

A past log keeps the links it was written with. When an entity is later split out of a
topic, its timeline events move to the new entity but the logs that pointed at the topic
stay as they were: that is where the material lived on the day they describe.

## Diary privacy

Assume day folders contain sensitive personal detail. Material intended for publication
belongs on a separate `<DD>/public-summary` page whose title, summary and body are safe
to expose; the owner still reviews and publishes it under the root privacy rule.
