# Diary conventions

This subtree inherits the [[about/agents|About conventions]]. The diary is the owner's
working memory: a curated day-by-day account of what they did, thought, decided and
worried about, with links to the durable subjects that explain it.

It is composed, not written alongside the knowledge it describes. An agent recording
something that happened puts it on the entity's `timeline` and stops there; the
[[automations/diary-composer/instructions|diary composer]] later reads the timelines that
changed and assembles the day from them. Nothing else writes a log, so a day is assembled
once from everything in it rather than accreted by whoever wrote last. The owner writes
here directly whenever they want to, and the composer preserves what they add.

## Structure

One folder per day at `about/diary/<YYYY>/<MM>/<DD>/`, zero-padded, with `<DD>/log` as the
entry point. Create a day only when there is something useful to record. A day folder is a
chronological container rather than a durable entity, which is why it uses `log` instead of
the root `intro` convention; do not add a redundant `intro`.

| Resource | Title |
| --- | --- |
| Year / month directory | `2026` · `July 2026` |
| Day directory | `Monday, 27 July 2026` |
| `log` page | `Log — Monday, 27 July 2026` |
| Other day pages | descriptive, date-suffixed |

The folder holds only pages and assets belonging to that day. Give long or structured
day-specific material its own page and link it from the log.

## The log

    # Log — Monday, 27 July 2026

    *<Location> · one line framing the day*

    Narrative prose about what happened, what it felt like and what changed, with
    durable subjects linked inline.

    ## On my mind
    - Short thoughts, doubts and half-formed ideas.

    ## Threads
    - [[about/projects/…|Project]] — what moved · continues [[about/diary/…|24 Jul]]

Keep these headings and order when the sections are useful; omit empty ones. Write the
summary last, from the finished log.

`On my mind` belongs to the owner. The composer never writes it and never infers a mood or
doubt from what the pages happen to say: an interior state nobody recorded is not
recoverable from a timeline, and inventing one is worse than omitting the section.

Link every durable subject the day touched, and link the entity rather than its timeline,
so a reader arriving at a day can walk out to everything it involved.

## Continuity

When work genuinely resumes from an earlier day, add one backward link on the relevant
`Threads` bullet: `· continues [[about/diary/…|24 Jul]]`. Link one hop to the most specific
earlier page, since following the chain recovers older context. Repeated mention is not
continuation — use the link only when work picks up where it left off — and never edit an
earlier log to add a forward pointer, because it records what was known then.

A chain that becomes cumbersome suggests the subject needs a durable page, project or task.

## Reading and maintenance

Start with today's log and work backward, usually about a week, following continuity links
for active threads. Treat an old mood, plan or open loop as a historical snapshot until
later logs confirm it. Periodically review recent logs for durable material that is hard to
retrieve from its subject, and promote only what earns a durable home. An optional
`about/diary/<YYYY>/<MM>/overview` may narrate what mattered in a month as a considered
review, not an automatic digest.

Do not rewrite a past log to tidy its prose or neaten a link chain. Do correct what is
wrong or misleading under the root reconciliation rule, preserving useful contemporaneous
experience; when the correction itself matters to the story, make it explicit and link the
later evidence. A past log otherwise keeps the links it was written with: when an entity is
split out of a topic, its timeline events move but the logs that pointed at the topic stay,
because that is where the material lived on the day they describe.

## Diary privacy

Assume day folders contain sensitive personal detail. Material intended for publication
belongs on a separate `<DD>/public-summary` page whose title, summary and body are safe to
expose; the owner still reviews and publishes it under the root privacy rule.
