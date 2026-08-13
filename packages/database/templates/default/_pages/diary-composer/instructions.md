# Diary composer

Compose diary days from activity already written to the knowledge base. This workflow
controls how changed evidence is gathered, assigned to days and checkpointed. The
[[about/diary/agents|diary guide]] controls what belongs in the diary and how each day is
structured and written.

## Contract

- Call `prepare_knowledge_write` with an empty target path, follow the [[agents|root guide]],
  and read [[automations/diary-composer/state|state]].
- Before the first mutation in a scope, prepare the exact diary target. Reuse its receipt for
  the same guide chain; pass the prior receipt as `cached_guidance_receipt` when the scope
  changes or a receipt is rejected.
- Run independently from every other automation and treat the fixed knowledge-change window
  as the entire input.
- Mutate only pages beneath `about/diary/` and this automation's state. Read entity pages for
  evidence and links; never repair them from this workflow.
- Preserve owner-authored and uncertain material exactly as the diary guide requires. Never
  put cursors, page identifiers, scan logs or reports in a day folder.

## State machine

### 1. Initialize the run

Read the state page. When its checkpoint is `_none_`, omit `cursor`; otherwise copy the opaque
value exactly.

### 2. Freeze the change window

Call `get_knowledge_changes` with that cursor and no `limit`. When `has_more` is true, call it
again with `next_page_token` as `page_token` and no cursor. Continue until `has_more` is false.

The first call fixes the window. Changes committed during this run remain after the returned
`next_cursor` for the next scheduled run. Do not restart or widen the window.

### 3. Load exact changed evidence

Ignore rows under `about/diary/` and `automations/diary-composer/` as activity input.

For every other non-deleted row, call `get_page_delta` once with its exact `page_id`,
`previous_version_number` and `version_number`. Use the returned metadata changes and exact
`before` and `after` Markdown fragments as the complete new evidence. Do not calculate another
diff.

- A null `previous_version_number` presents the page as newly available baseline evidence;
  activity dates still come only from its content.
- When `comparison.complete` is false, use the returned comparison from
  `actual_from_version` through `to_version` and do not infer pruned changes.
- On `PAGE_DELTA_UNAVAILABLE`, record the error and do not reconstruct the delta from the
  current page.
- For a deleted row, use the tombstone only to locate existing diary passages that linked the
  removed page. Reconcile one only when retained evidence shows exactly what support was
  withdrawn; deletion alone proves no opposite claim.

Call `get_page` only when a changed fragment needs current context to identify its subject,
relationship, activity date or useful link. Unchanged current prose is context, never new
activity evidence.

### 4. Derive the affected days

Apply the diary guide's selection rules to the changed fragments.

- Timeline event deltas are the primary chronology. A non-timeline delta qualifies only when
  the changed material itself establishes something the owner did, experienced, decided or
  learned and supplies a reliable activity date.
- `changed_at`, creation time, commit time and this run's date never choose a diary day.
- Maintenance edits, link repairs and durable facts do not become activity merely because a
  page changed.
- A one-word correction contributes only its corrected meaning, not the surrounding page.
- There is no recency cutoff: newly received historical evidence affects its historical day.

Group entity-side deltas that describe the same meeting, exchange, decision or movement into
one activity with all useful links. Shared date alone does not join unrelated activities.
When a correction changes an activity date, mark both the formerly supported day and the
corrected day as affected.

A window may legitimately affect no diary day.

### 5. Gather context for each affected day

For each affected date:

1. Read the current `intro` and every companion view reachable from it. If a legacy day has a
   `log` but no `intro`, retain `log` as a companion and create an entry point that reaches it.
2. Use `get_page_history` only as far as needed to distinguish composer-owned passages from
   owner additions. Treat uncertain authorship as the owner's.
3. Read a current occurrence or entity page only when the delta does not provide enough
   context to understand the relationship or choose the destination link. Do not mine it for
   unchanged facts to repeat.
4. Use `browse_directory` on the relevant year or month to locate earlier days. Use
   `search_pages` with canonical subject paths, and follow existing continuity links, to find
   the latest useful diary context for each arc that genuinely continues.

Reading an earlier day supplies evidence for a continuity link; it does not require one.

### 6. Reconcile each affected day

Prepare the exact day target and apply the diary guide. Integrate only the support changed in
this fixed window. Do not rebuild an unaffected day or retell a changed entity's current body.

On replay, the same ledger window must converge on the same semantic day rather than append a
second rendition. Update only composer-owned passages. Archive only a companion page created
by this automation whose useful material has moved elsewhere; preserve every other byte.

If a diary mutation fails, leave the old checkpoint in force, stop, and report the actual
error.

### 7. Save the checkpoint and report

After every intended diary mutation succeeds, replace the state body with exactly:

    # Diary composer state

    **Checkpoint:** `<next_cursor>`

Keep the existing title and summary. Save the fixed window's `next_cursor` even when no day
required a semantic change. A state-write failure leaves the prior checkpoint for replay.

Report:

- the number of affected days reconciled and whether the change ledger is caught up;
- a concise account of continuity found, subjects deliberately kept separate, and unresolved
  delta or activity-date errors; and
- `Created`, `Updated` and `Archived` lists naming every diary page mutated, with exact path
  and a short description.

Exclude structural directories and the operational state page. Write `None` for an empty
list. Never claim the window completed if a required delta, diary mutation or state update
failed.
