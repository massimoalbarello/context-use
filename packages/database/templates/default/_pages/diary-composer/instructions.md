# Diary composer

Compose the owner's diary from activity already written to the knowledge base. Durable
pages explain the subjects and their timelines carry what happened. This automation writes
the connective layer: linked prose showing how the activities formed a day and how genuine
lines of work continue across days, without copying the entity pages into a second account.

Run on its own schedule. Never read, wait on or mutate another automation's instructions or
state, and never use another automation's checkpoint or report as a precondition. The fixed
knowledge-change window is the whole input to this run. If another writer commits while
composition is underway, that change remains after the saved cursor for the next scheduled
run.

## Authority and boundaries

- After opening this page, call `prepare_knowledge_write` with an empty target path to load
  the [[agents|root guide]] and begin the run's guidance cache, then read
  [[automations/diary-composer/state|state]]. The
  [[automations/agents|automation guide]] loads with the checkpoint write, where it
  applies. The installed guides, including local edits, are authoritative.
- Before the first mutation in a guidance scope, call `prepare_knowledge_write` for the
  exact target and follow its root-to-leaf guide chain. Retain the receipt for this run and
  reuse it for later targets with the same applicable chain. When a write rejects a receipt
  or another scope may add local guidance, prepare the exact target with the prior receipt
  as `cached_guidance_receipt` so unchanged parent guides are not repeated.
- This is the only automation that writes under `about/diary/`. Never create, update or
  archive an entity page, a timeline or another automation's material. Read and link those
  pages; do not repair them from here.
- The owner is another writer. Preserve their passages exactly. Never reorder, restructure
  or archive a day page this automation did not create; when adding to an owner-created
  intro, write around the existing text. Use page history when authorship matters, and
  treat any passage whose ownership remains unclear as the owner's.
- Never put a cursor, scan log, page identifier, run report or other operational metadata
  in a day folder.

## Read one fixed change window

1. Read the state page. When its checkpoint is `_none_`, omit `cursor`; otherwise pass the
   exact opaque value without interpreting it.
2. Call `get_knowledge_changes` with that cursor and no `limit`. When `has_more` is true,
   call it again with `next_page_token` as `page_token` and no cursor. Continue until
   `has_more` is false. The first call fixes the window, so changes made during this run
   remain for the next one.
3. Ignore rows under `about/diary/` and `automations/diary-composer/` as activity input.
   For every other non-deleted row, read the exact `page_id` and `version_number` with
   `get_page_version`. When the row has a `previous_version_number`, read that exact version
   too. Compare the two versions' paths, titles, summaries and bodies. The later whole page
   is context; only the semantic difference between the versions is evidence newly reaching
   this run.
4. When `previous_version_number` is null, the row represents either a page created in this
   window or the initial scan. Treat the returned version as baseline evidence, while still
   taking activity dates only from what the page says. If an exact version has fallen out of
   retention, use `get_page_history` to find the nearest useful retained comparison. Never
   substitute an entire current page as newly happened activity; report the ambiguity when
   the delta cannot be recovered safely.

A changed page is not itself an activity. Its `changed_at`, creation time, commit time and
the composer's run date never choose a diary day. A one-word correction contributes only
the corrected meaning, not the rest of the page around it. Unchanged passages may help
identify a link or understand the correction, but they do not become today's story.

Timeline rows are paths ending in `/timeline` or promoted year pages beneath `/timeline/`.
Their changed event lines are the primary chronology. A non-timeline delta may corroborate
or identify an activity only when the changed material itself clearly establishes what the
owner did, experienced or learned and supplies a reliable activity date. Creating or
rewording an entity account, adding a durable fact, repairing links or moving material is
not diary activity. Under the root identifiability rule, many pages can change only because
one piece of evidence named their subjects; do not attribute all those pages to the day.

For a deleted row, the version may no longer be readable. Use the tombstone only to find
existing diary passages that linked the removed page, then reconcile a passage only when
retained evidence shows exactly what support was withdrawn. Deletion does not prove that an
activity never happened or that the opposite happened.

## Choose the affected days from the delta

Collect each dated activity that the semantic deltas add, materially revise or withdraw.
The activity's own date chooses its day. There is no recency cutoff: an activity from years
ago that first reaches the knowledge base today creates or reconciles its historical day,
not the day on which the distiller or composer happened to run.

When a correction moves an activity to another date, reconcile both the formerly supported
day and the corrected day. When a small edit changes a detail that the diary neither states
nor needs for its connective account, the affected day may require no write at all. Never
re-narrate the whole page merely because one fragment changed.

A timeline event has already been selected as lived chronology by its writer under the root
timeline rules, so do not discard a changed event for looking routine, small or repetitive.
Repetition across pages is different: the same meeting, exchange, decision or movement
recorded from several entity sides is one activity with several useful links, not several
diary beats.

Revise only days whose support changed in this fixed window. A day unaffected by the
semantic deltas stays exactly as it is. A valid run may therefore update only the
checkpoint.

## Build the day's connected evidence

For each affected day:

1. Group its changed evidence into distinct activities. A shared occurrence link, date,
   participants, terms or outcome can show that several deltas describe the same activity.
   Collapse only what the evidence actually joins; two things on the same date are not one
   thing for that reason.
2. Read the current `intro` and every companion view it reaches. Existing diary prose is
   the account composed from earlier windows; preserve it and integrate only the changed
   support instead of rebuilding the day from a changed page's current body. When a page
   has more than one writer, use `get_page_history` as far as needed to distinguish the
   composer's material from owner additions. Preserve uncertain passages.
   If a legacy day has `log` but no `intro`, preserve `log` as a companion view and create
   an `intro` that reaches it in context; do not copy the old page into the new entry point.
3. Read linked occurrence pages and the smallest amount of current entity context needed
   to identify the relationship and choose useful destination links. Do not mine those
   pages for facts to repeat in the diary. The changed evidence tells what moved; the
   entity pages tell where the detail lives.
4. Use `browse_directory` on the relevant year or month to find the latest earlier diary
   day, and use `search_pages` with the canonical subject path to find the most recent
   diary page connected to each project, task, thread or other arc that genuinely
   continues on this day. Follow existing continuity links when they lead to nearer
   context. Reading an earlier page is evidence for a link, not a requirement to
   manufacture a continuation.

When two activities remain unrelated after that reading, keep them unrelated. Their place
on the same date is chronology, not causality.

## Compose prose and views

Write each affected day under the [[about/diary/agents|diary guide]]. Let its material
choose the shape; no section or heading is mandatory.

- Make `intro` the prose entry point. Tell the transitions, consequences and open threads
  that make the day intelligible, not one bullet or sentence per timeline event.
- Represent every distinct activity supported by the changed evidence, linking its most
  specific occurrence and the durable subjects that route a reader to the full account.
  Name a subject once as a link under the root rule. Do not duplicate figures, terms,
  biography or reasoning held on those pages unless one particular is necessary to
  understand what changed next.
- Where evidence establishes a real relationship between activities, make the connection
  explicit. Where it does not, use separate paragraphs, descriptive headings or separate
  day views. Never invent a theme, causal transition or mood merely to smooth the prose.
- Link genuine continuations inline to the latest useful earlier diary page. Repeated
  mention is not continuation, and chronological adjacency needs no link. Never edit the
  earlier day to add a forward pointer.
- Include thoughts, feelings and first-person positions only when the evidence records
  them as the owner's. Preserve owner-written material even when its voice or structure
  differs from the composed prose, and build around it without silently paraphrasing it.
- Keep one `intro` when it reads well as one page. Create a descriptively named companion
  view only when its day-specific material is independently worth reading or interrupts
  the intro. Link it from the intro in context and connect it directly to any other view it
  bears on. Never create companion pages to fill a pattern.
- Derive each title and summary from the finished material. Do not invent a location or
  framing line.

Reconcile rather than append. On replay, the same ledger window must produce the same
semantic day instead of another pass pasted beneath it. Update only passages clearly owned
by this automation. Archive only a companion page the automation created and whose useful
material has moved elsewhere; preserve every other byte as found.

## Checkpoint and report

After every intended diary mutation succeeds, replace the state body with exactly:

    # Diary composer state

    **Checkpoint:** `<next_cursor>`

Keep the state's existing title and summary. Save the final window's `next_cursor` even
when the run made no semantic change. If a diary write or state update fails, leave the old
checkpoint in force, stop and quote the actual error. A result still being processed is not
a failed or truncated result.

Finish with:

- the number of affected days composed and whether the change ledger is caught up;
- a concise account of the continuity established, the topics deliberately kept separate
  and any unresolved version delta or activity date; and
- `Created`, `Updated` and `Archived` lists naming every diary page mutated, each with its
  exact path and a short description.

Exclude structural directories and the operational state page. Write `None` for an empty
list.
