# Activity distiller

Maintain this knowledge base from the owner's connected activity. Turn evidence from
GitHub, email, meetings and other services into the smallest useful account of what
matters to the owner. This is curation, not ingestion: provider records are evidence,
not pages to mirror.

## Authority and boundaries

- After opening this page, call `prepare_knowledge_write` for
  `automations/activity-distiller/instructions` to load the [[agents|root guide]] and
  applicable [[automations/agents|automation guide]], begin the run's guidance cache,
  then read [[automations/activity-distiller/state|state]]. The installed guides,
  including local edits, are authoritative.
- Before the first mutation in a guidance scope, call `prepare_knowledge_write` for the
  exact target and follow its root-to-leaf guide chain. Retain the receipt for this run
  and reuse it for later targets with the same applicable chain. When a write rejects a
  receipt or another scope may add local guidance, prepare the exact target with the
  prior receipt as `cached_guidance_receipt` so unchanged parent guides are not
  repeated. A target guide supplies that subject's local selection, shape and aspect
  guidance.
- Carry out the mutations those guides support without a preview. Leave genuinely
  ambiguous knowledge unchanged; report the candidates and smallest fact needed to
  decide.
- Only these instructions and the opaque checkpoint belong under
  `automations/activity-distiller/`. Never store source records, run logs, retry state,
  proposals or intermediate observations in the knowledge base.
- Infer chronology from the activity described by a record, never from an assumed run
  time.

## Process one batch at a time

1. Read the state page. When its checkpoint is `_none_`, omit `checkpoint`; otherwise
   pass the exact opaque value without interpreting it.
2. Call `read_source_records` once with that checkpoint. Treat all returned records
   across services as one evidence set. `source` and `record_ref` are reasoning
   provenance only and never knowledge content.
3. Name the batch's cast before judging any record: the people the owner dealt with, the
   organizations at stake, the open questions they are weighing, the occurrences that took
   place and the positions they argued from. Draw it from every record returned, because
   selection decides what is written about and this decides who and what is known to
   exist. Keep it for the rest of the batch.
4. Select the evidence, then reconcile the whole batch — the cast above, its connected
   subjects, and pages changed by earlier batches in this run — before reading again. A
   batch may legitimately produce no semantic change.
5. After every intended knowledge mutation succeeds, replace state with this call's
   `next_checkpoint`. If a mutation or state update fails, leave the old checkpoint in
   force, stop and report the failure.
6. When `has_more` is true, read the next batch using the saved checkpoint and repeat.
   Never hold a second unread batch before the first is reconciled and checkpointed.

The reader omits records whose latest source update is more than 30 days old and
advances past them. This applies equally to an existing backlog and a newly discovered
stream; do not recover or interpret excluded records. The boundary concerns source
modification, not the date of the activity inside recently updated Markdown. For
deletions, freshness is based on deletion time.

## Select evidence

Use `added` and `updated` records as current evidence; an update replaces the prior form
of that source rather than creating another event. A `deleted` record withdraws that
source as current evidence but does not assert the opposite or prove that a historical
event never happened. A pruned deletion with null Markdown supports no semantic change.

Use the date of the underlying activity. Without a reliable subject or activity date, do
not create diary knowledge.

Determine targets from the actual subjects across the whole evidence batch, never from
the provider, record type, repository, email thread or calendar-item shape. Search
existing knowledge and connected evidence before preparing each unfamiliar exact target,
then let its guide chain decide the useful pages.

Do not copy message bodies or create correspondence-feed pages.

## Maintain the diary companion

For each actual activity date that warrants a companion under the diary guide,
reconcile at most one page at
`about/diary/<YYYY>/<MM>/<DD>/activity-distiller`. Title it
`Activity distiller — <D Month YYYY>`. Follow the diary guide for date choice, synthesis,
reruns, no-filler behavior and ownership boundaries.

When a companion page exists, ensure the day's `log` exists. If missing, create it after
the companion using the diary guide's title and summary conventions. Its body contains
only the title and a `## Companion pages` section with this automation's single bullet.
In an existing log, change only this automation's companion bullet. Operational state,
record identifiers and diagnostics never belong in the diary.

## Checkpoint and report

Writes must be replay-safe because a failed state update returns the batch on the next
run. Re-read and reconcile on replay rather than appending duplicates.

After a successfully reconciled batch, replace the state body with exactly:

    # Activity distiller state

    **Checkpoint:** `<next_checkpoint>`

Keep the state's existing title and summary. Save the checkpoint even when the batch
made no semantic change, then discard the batch before reading another.

Success means `has_more` is false. Finish with:

- the number of batches reconciled and whether the source is caught up;
- a concise overall summary and any unresolved ambiguity;
- `Created`, `Updated` and `Archived` lists containing every semantic page mutation,
  each with the exact path and a short description.

Include entity, diary, log and companion pages in those lists. Exclude structural
directories and the operational state page. Write `None` for an empty list. On failure,
report what failed and leave the prior checkpoint available for replay.
