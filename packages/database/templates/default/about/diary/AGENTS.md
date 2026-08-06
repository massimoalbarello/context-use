# Diary conventions

This subtree inherits the [[about/agents|About conventions]]. The diary is the owner's
working memory: a curated day-by-day account of what they did, thought, decided and
worried about, with links to the durable subjects that explain it.

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
Write the log summary last, from the finished entry.

## The log

    # Log — Monday, 27 July 2026

    *<Location> · one line framing the day*

    Narrative prose about what happened, what it felt like and what changed, with
    durable subjects linked inline.

    ## On my mind
    - Short thoughts, doubts and half-formed ideas.

    ## Threads
    - [[about/projects/…|Project]] — what moved · continues [[about/diary/…|24 Jul]]

    ## Companion pages
    - [[about/diary/…|Title]] — one line (automation: `<automation-slug>`)

Keep these headings and order when the sections are useful; omit empty sections. The
narrative carries the lived texture, `On my mind` holds emerging thoughts, `Threads` is
the day's edge list, and `Companion pages` points to substantial material kept outside
the log.

A linked day is easier to retrieve than an isolated one. When the day contains a
material entity event or state change, apply the bidirectional diary/timeline contract
in the [[agents#diary-and-entity-timelines|root guide]]. A durable fact left only in a
log is hard to find from its subject: reconcile it into the canonical page, then let the
log say what happened that day and link the result.

## Continuity

When work genuinely resumes from an earlier day, add one backward link on the relevant
`Threads` bullet: `· continues [[about/diary/…|24 Jul]]`.

- Link one hop to the most specific earlier page. Following the chain recovers older
  context, so repeating its whole ancestry is unnecessary.
- Do not edit an earlier entry merely to add a forward pointer; it records what was known
  then.
- Repeated mention is not automatically continuation. Use the link only when work picks
  up where it left off.

A chain that becomes cumbersome is evidence that the subject may need a durable page,
project or task. Repetition is a signal to review placement, not proof that a new entity
or page is necessary.

## Automation companion pages

The general automation contract is in [[automations/agents|the automation guide]]. For
automation-owned material inside a day folder:

- Keep at most one page per automation per affected day, at
  `<DD>/<automation-slug>`. Keep the slug stable across days; title the page
  `<Automation name> — <D Month YYYY>` and summarize the activity on that date rather
  than the pipeline run.
- Use the date when the recorded activity happened, not the date the automation ran.
  One run may therefore create or revise several affected days.
- Reconcile reruns into one concise account of the material activity. Do not append run
  logs or create a page per input item.
- When linking output from the log, maintain one automation-owned bullet under
  `Companion pages`. Leave the owner's narrative, `On my mind`, `Threads`, and other
  automations' pages and bullets unchanged.
- Create no filler page when there is nothing useful to report. Keep execution state and
  operational metadata outside the diary.

## Reading and maintenance

- Start with today's log and work backward, usually about a week. Follow continuity
  links for active threads and outward links for durable context.
- Treat an old mood, plan or open loop as a historical snapshot until later entries
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

## Diary privacy

Assume day folders contain sensitive personal detail. Material intended for publication
belongs on a separate `<DD>/public-summary` page whose title, summary and body are safe
to expose; the owner still reviews and publishes it under the root privacy rule.
