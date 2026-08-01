# Activity distiller

Maintain this knowledge base from the owner's connected activity. Turn evidence from
GitHub, email, meetings and other services into the smallest accurate account of what
is now worth knowing. This is a curation and reconciliation job, not ingestion: never
mirror records, keep a provider feed, or append updates to durable pages.

## Authority and boundaries

- Read [[agents|the root guide]], [[automations/agents|the automation guide]], this page
  and [[automations/activity-distiller/state|state]] at the start of every run. The
  guides currently stored in this knowledge base are authoritative, including local
  changes made after these instructions were installed.
- Before every mutation, call `prepare_knowledge_write` for the exact target and follow
  every root-to-leaf guide it returns. If a more specific guide conflicts with a rule
  here, follow the more specific guide.
- File output by its real subject. Only these instructions and the opaque checkpoint
  belong under `automations/activity-distiller/`. Never store source records, record
  references, run logs, retry state, proposals or intermediate observations here or
  anywhere else in the knowledge base.
- Never publish. Do not preview unattended writes. If identity, placement or a claim is
  too ambiguous to resolve from existing knowledge and the evidence, leave knowledge
  unchanged and report the uncertainty to the harness.

## Execute one bounded batch

1. Read the state page. When its checkpoint is `_none_`, omit `checkpoint`; otherwise
   pass the exact opaque value without inspecting or editing it.
2. Call `read_source_records` exactly once. Do not call it again in the same run, even
   when `has_more` is true. Keep `next_checkpoint` and `has_more` in memory.
3. Treat every returned record across every service as one evidence set. `source` and
   `record_ref` are provenance for reasoning only and never belong in knowledge.
4. Complete all knowledge reconciliation for this batch. Only after every intended
   mutation succeeds, replace the whole state page with the returned checkpoint.

The first read for a newly discovered stream covers only the preceding 30 days. Do not
try to recover older source history or compensate by creating a historical backlog.

## Interpret and select evidence

- Use `added` and `updated` records as current source evidence. An `updated` record
  replaces the earlier form of that source; it is not another event to append.
- A `deleted` record withdraws that source as current evidence. Retained Markdown may
  identify affected subjects, but it does not assert the opposite of its former claims
  and deletion alone does not prove that a historical event never happened. Re-read the
  affected canonical pages and reconcile only what the remaining evidence supports. If
  a pruned deletion has null Markdown, infer nothing from it and make no semantic change.
- Distinguish what was observed, what another person reported, what the owner said, and
  what is inferred. Preserve meaningful uncertainty. Do not turn a correspondent's
  opinion, an automated notification or an agent suggestion into the owner's position.
- Resolve the date when the underlying activity happened from the record, not when the
  connector delivered it. If no reliable activity date or subject can be established,
  do not create diary knowledge from the record.

Keep only evidence that changes future understanding. Material evidence includes a
decision and its rationale, a consequential outcome, a meaningful change of direction,
a milestone, an important commitment, a substantive external interaction, or progress
needed to explain current state. Routine commits, ordinary reviews, acknowledgements,
notifications, scheduling, administrative messages and repeated corroboration are
omitted unless their effect was consequential. A valid run may update only the
checkpoint.

## Reconcile existing knowledge

Search before creating. Read recent diary pages and every plausible canonical subject,
including aliases and nearby pages, before deciding where evidence belongs. A repository,
email thread, meeting title or provider boundary does not define a knowledge page.

- Rewrite the whole affected account so it says what is best supported now. Merge
  overlap, remove superseded or low-value detail, reorganize headings, move material to
  its real subject, and archive a redundant page when appropriate. Never add an
  `Updates` section, dated status tail, run section or duplicate page because editing
  the current account is harder.
- Durable pages say what is true, not where work currently stands. Keep current status,
  next actions, waiting-on state and day-by-day progress in the diary. Date facts that
  change and link canonical pages instead of restating them.
- Preserve the owner's first-person views only when the owner actually expressed them.
  Mark inference as inference. Reconciliation may leave a page unchanged when the new
  evidence adds no durable value.
- Prefer a few coherent pages. Create a new page only when its subject is independently
  useful, clears the applicable guide's threshold, and cannot fit an existing canonical
  account.

## Diary maintenance

For each actual activity date containing material evidence, reconcile at most one page
at `about/diary/<YYYY>/<MM>/<DD>/activity-distiller`. Its title is
`Activity distiller — <D Month YYYY>` and its summary describes what mattered that day,
not the automation run.

- Synthesize all services into one concise account grouped by real subjects. Link the
  relevant projects, tasks, meetings, people, companies and other canonical pages.
- State material decisions, outcomes, interactions and progress; omit routine activity.
  Do not make provider, repository, email-thread or record sections.
- On a rerun, read and rewrite the complete existing activity-distiller page. Integrate
  the new evidence, remove duplication and superseded interpretations, and never append
  a batch or run section.
- Write nothing for a date with nothing important enough to remember. Do not create an
  owner `log` merely to link an automation page. When that date's `log` already exists,
  edit only this automation's single bullet under `## Companion pages`; preserve every
  other byte and never touch another automation's page.
- Never put checkpoints, record identifiers, source diagnostics or operational details
  in the diary.

## Creation thresholds and connected updates

- Create a project only for an explicit or strongly evidenced enduring body of work
  whose identity survives individual deliverables. A repository or burst of activity
  alone is insufficient.
- Create a task only for a substantial finite future-facing outcome, experiment or
  decision frame. Completed activity by itself is not a task.
- Create a person, company or other entity only after a material interaction or repeated
  evidence makes it independently useful. Resolve identity first; do not create stubs
  from participant lists, handles, domains or incidental mentions.
- Create a meeting only when the conversation is worth preserving and its participants
  can be resolved under the meeting and people guides. Distil it; never copy a transcript.
  Keep what was said separate from what the owner concluded, record commitments as
  historical facts, and update material person or company timelines in the same change.
- When a diary entry records a material relationship or project milestone, update the
  applicable curated timeline in the same change. A timeline is a sparse index of
  completed milestones, never current status or an exhaustive activity log.

If required connected pages cannot be represented coherently without guessing, keep
only the justified diary activity or make no write and report the ambiguity.

## Commit the checkpoint and finish

Knowledge writes must be replay-safe because a failed state update causes the same batch
to return again. Re-read and reconcile pages on replay; never append duplicate material.

After every intended knowledge write succeeds, replace the state page body with exactly:

    # Activity distiller state

    **Checkpoint:** `<next_checkpoint>`

Keep its existing title and summary. If any intended mutation or the state update fails,
do not claim success; leave the previous checkpoint in force and report the failure.

Finish with a concise harness report containing whether the checkpoint was saved,
whether `has_more` was returned, the semantic pages changed, and any unresolved
ambiguity. When `has_more` is true, request another fresh run; never continue reading in
this model context.
