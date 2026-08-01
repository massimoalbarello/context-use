# Automations conventions

`automations/` stores the instructions, minimal durable state and supporting assets for
automations that run in an **external harness**. The harness schedules and executes jobs
and owns retries and run history. This base supplies versioned instructions, knowledge
and one safe place for an opaque checkpoint. Credentials never belong on a page.

## Structure

- One stable kebab-case directory per automation: `automations/<automation-name>/`.
- Its canonical instruction page is `automations/<automation-name>/instructions`.
  Reserve that leaf for it.
- When incremental input requires it, use exactly one stable
  `automations/<automation-name>/state` page. It contains only the current opaque
  checkpoint and, if useful, the last successful completion time. No dated state pages,
  record ledger, retry log or copied source material.
- Supporting context an automation needs — an HTML template, a prompt fragment — lives
  beside it in the same directory, and nothing else does.

These are ordinary private pages, read and edited through the normal tools; the external
harness reaches them over the authenticated connection. The harness still owns the
schedule, credentials, process health and operational history.

## Knowledge boundaries

- **Output is filed by its subject, never by its author or source.** Activity goes on
  the actual day's diary page; enduring owner work goes in `about/projects/`; people,
  companies and other entities keep their canonical homes. Knowledge never accumulates
  under the automation except its instructions, minimal state and true support assets.
- **Access to a shared page is not permission to rewrite someone else's material.** An
  automation that adds its companion link to the day's log edits that link and nothing
  else.
- **Uncertain or unsupported proposals are reported through the external harness, not
  written as knowledge.** Do not put pipeline proposals in the diary or smuggle them
  into state; neither describes something the owner actually did.
- **Automations never publish**, and — unlike an interactive agent — they do not preview
  before writing, because there is nobody to ask
  ([[agents#before-writing-identify-propose-preview|root rule]]). That is why their
  instructions must state their scope and maintenance policy precisely.

## Cross-source distillation

A distillation automation treats every connected source as evidence about the same
owner. Connection and provider boundaries are provenance, not knowledge architecture.
Interpret each bounded batch together: separate records may describe the same project,
day, decision, person or milestone and reinforce, qualify or contradict one another.
Use only each source record's lifecycle action and canonical Markdown; do not build
provider-specific logic from its envelope. `added` and `updated` carry current evidence.
`deleted` withdraws source evidence: use retained Markdown only to locate affected
knowledge, never as a current claim. A pruned deletion may have no Markdown; do not
invent what it contained.

On every run, in this order:

1. Read `instructions` and the single `state` page. Call the unified source-record tool
   once with its checkpoint and keep that bounded batch and returned checkpoint in
   memory. A newly discovered source starts with the preceding 30 days; older history
   is intentionally excluded. Do not drain multiple batches into one model context.
2. Read recent diary pages, search the whole base for likely subjects, and read every
   existing page that might already own the evidence. New names, repository labels or
   source-specific wording are never enough to assume a new subject.
3. Form one evidence set across all sources. Decide what happened on each actual day,
   which enduring subjects it bears on, whether evidence was added, changed or withdrawn,
   and whether any claimed connection is observed, reported or inferred. Source records
   are evidence, not pages to mirror.
4. Reconcile semantic knowledge under
   [[agents#reconcile-never-append-by-default|the root rule]]. Rewrite and reorganize
   existing pages as needed; merge overlaps, split only independently useful subjects,
   remove superseded detail and archive redundant pages. Creating a page is the last
   option, not the default response to a new record.
5. Reconcile at most one automation-owned diary page for each date with activity
   important enough to remember under
   [[about/diary/agents#automations-in-the-diary|the diary rules]], linking outward to
   projects, tasks and entities. Omit routine or low-value activity entirely. The diary
   says what materially happened; durable pages say what is true.
6. Only after every intended knowledge mutation succeeds, replace `state` with the final
   opaque checkpoint. On any failed or uncertain write, leave state unchanged so the
   evidence is safely replayed on the next run. If `has_more` is true, let the harness
   start a fresh bounded run from the saved checkpoint.

Do not create an intermediate observation, inbox or per-record processing model in the
knowledge base. The source cache and opaque checkpoint already provide replay; page
versions preserve prior knowledge. A run may legitimately make no semantic change when
the existing base already expresses the evidence cleanly.

## Creation thresholds

- Prefer an existing project, task or entity whenever the identity plausibly matches;
  search aliases and contextual clues before deciding.
- Create a [[about/projects/agents|project]] only for an explicit or strongly evidenced
  enduring body of work, not for each repository or burst of activity.
- Create a [[about/tasks/agents|task]] only for a real finite future-facing pursuit or
  decision, not as a retrospective container for things already done.
- Create people, companies and other entities only when they are repeated, materially
  involved, or useful to retrieve independently. A mention or participant list alone is
  insufficient.
- When evidence is too weak to clear a threshold, keep the dated activity and links that
  are justified. Waiting is better than filling the base with speculative stubs.

Diary-specific mechanics — page naming, the `## Companion pages` bullet and continuity
between days — are in [[about/diary/agents|the diary conventions]].
