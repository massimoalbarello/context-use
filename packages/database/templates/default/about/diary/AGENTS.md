# Diary conventions

This subtree inherits the [[about/agents|About conventions]]. The diary is the owner's
working memory: a curated day-by-day account of what they did, thought, decided and
worried about, with links to the durable subjects that explain it.

Use one folder per day at `about/diary/<YYYY>/<MM>/<DD>/`, with zero-padded path segments
and `<DD>/log` as the day's entry point. A day folder is a chronological container, not a
durable entity, so it uses `log` instead of the root `intro` convention.

| Resource | Title |
| --- | --- |
| Year / month directory | `2026` · `July 2026` |
| Day directory | `Monday, 27 July 2026` |
| `log` page | `Log — Monday, 27 July 2026` |

    # Log — Monday, 27 July 2026

    *<Location> · one line framing the day*

    Narrative prose about what happened, with durable subjects linked inline.

    ## On my mind
    ## Threads
    ## Companion pages
    - [[about/diary/…|Title]] — one line (automation: `<automation-slug>`)

Keep these headings and order when the sections are useful; omit empty sections.

## Automation companion pages

The general automation contract is in [[automations/agents|the automation guide]]. For
automation-owned material inside a day folder:

- Keep at most one page per automation per affected day, at `<DD>/<automation-slug>`,
  titled `<Automation name> — <D Month YYYY>`.
- Use the date when the recorded activity happened, not the date the automation ran.
- Maintain one automation-owned bullet under `Companion pages`, leaving the owner's
  narrative, `On my mind`, `Threads` and other automations' bullets unchanged.
- Create no filler page when there is nothing useful to report.

Assume day folders contain sensitive personal detail.
