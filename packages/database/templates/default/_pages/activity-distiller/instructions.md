# Activity distiller

Maintain this knowledge base from the owner's connected activity. Turn evidence from
GitHub, email, meetings and other services into the smallest useful account of what
matters to the owner. This is curation, not ingestion: provider records are evidence,
not pages to mirror.

## Authority and boundaries

- Read the [[agents|root guide]], [[automations/agents|automation guide]], this page and
  [[automations/activity-distiller/state|state]] at the start of every run. The installed
  guides, including local edits, are authoritative.
- Before every mutation, call `prepare_knowledge_write` for the exact target and follow
  its root-to-leaf guide chain. A target guide supplies that subject's local selection,
  shape and aspect guidance.
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
3. Reconcile the whole batch, including its connected subjects and pages changed by
   earlier batches in this run, before reading again. A batch may legitimately produce
   no semantic change.
4. After every intended knowledge mutation succeeds, replace state with this call's
   `next_checkpoint`. If a mutation or state update fails, leave the old checkpoint in
   force, stop and report the failure.
5. When `has_more` is true, read the next batch using the saved checkpoint and repeat.
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
event never happened. Reconcile the affected account from remaining evidence. A pruned
deletion with null Markdown supports no semantic change.

Apply the root guide's evidence distinctions and use the date of the underlying
activity. Without a reliable subject or activity date, do not create diary knowledge.

Keep only evidence that changes future understanding: a decision and rationale,
consequential outcome, meaningful change of direction, milestone, important commitment,
substantive external interaction, or progress needed to explain a material state
change. For high-volume sources, substantive owner participation, a consequential
relationship, durable fact or decision, real commitment, or connection to an already
important subject demonstrates value. Volume, recency and availability do not.

Ignore by default:

- unsolicited messages without meaningful owner engagement;
- newsletters, receipts, automated alerts and platform notifications;
- cold outreach, acknowledgements, routine scheduling and administrative mail; and
- ordinary commits, routine reviews and repeated corroboration with no consequential
  effect.

An email thread matters only through the knowledge it establishes—for example, a
substantive reply, commitment, relationship development, decision, or material advance
to a project or task. Do not copy message bodies or create correspondence-feed pages.
Several low-value records do not become important merely by accumulation. A valid run
may update only the checkpoint.

## Reconcile connected subjects

Determine targets from the actual subjects across the whole evidence batch, never from
the provider, record type, repository, email thread or calendar-item shape. Search
existing knowledge and connected evidence before preparing each unfamiliar exact
target, then let its guide chain decide the useful pages. Apply the root timeline
contract in the same coherent write whenever an entity milestone is recorded.

## Prepare from future signals

A consequential future interaction or commitment can trigger useful preparation.
Research and reconcile relevant existing subjects without describing the future event
as if it had happened.

A confirmed substantive meeting may have a `prep` page before it has an `intro`.
Classify calendar-shaped evidence by its actual subject under
[[meetings/agents|Meetings]] and [[events/agents|Events]]; do not create both types
unless each is independently useful. An upcoming event has no default prep page, so
update only independently justified related knowledge until the event occurs.

For a useful meeting prep:

1. Apply the meeting guide's participant rule to the people and companies that
   materially affect the conversation.
2. Search earlier meetings, substantive correspondence, introductions, commitments and
   shared projects or tasks, then read the canonical pages they point to.
3. Research missing identity or role facts from reliable sources only as far as needed
   for this conversation.
4. Reconcile the prep and any other pages justified by their own guides. Surface why the
   meeting matters, relevant history and useful questions or unknowns; do not produce a
   research dossier.

After the available research, keep unresolved identities out of the connected write and
group their ambiguity into one concise report item for the meeting.

## Maintain the diary companion

For each actual activity date that warrants a companion under the diary guide,
reconcile at most one page at
`about/diary/<YYYY>/<MM>/<DD>/activity-distiller`. Title it
`Activity distiller — <D Month YYYY>`. Follow the diary guide for date choice, synthesis,
reruns, no-filler behavior and ownership boundaries.

When a companion page exists, ensure the day's `log` exists. If missing, create it after
the companion using the diary guide's title and summary conventions. Its body contains
only the title and a `## Companion pages` section with this automation's single bullet.
Derive its summary and bullet from the material activity; do not invent a location,
narrative, `On my mind` or `Threads` content. In an existing log, change only this
automation's companion bullet. Operational state, record identifiers and diagnostics
never belong in the diary.

## Checkpoint and report

Writes must be replay-safe because a failed state update returns the batch on the next
run. Re-read and reconcile on replay rather than appending duplicates.

After a successfully reconciled batch, replace the state body with exactly:

    # Activity distiller state

    **Checkpoint:** `<next_checkpoint>`

Keep the state's existing title and summary. Save the checkpoint even when the batch
made no semantic change, then discard the batch before reading another.

Success means `has_more` is false. The final saved checkpoint makes the next scheduled
invocation start after the source lifecycle changes covered by this run. Finish with:

- the number of batches reconciled and whether the source is caught up;
- a concise overall summary and any unresolved ambiguity;
- `Created`, `Updated` and `Archived` lists containing every semantic page mutation,
  each with the exact path and a short description.

Include entity, diary, log and companion pages in those lists. Exclude structural
directories and the operational state page. Write `None` for an empty list. On failure,
report what failed and leave the prior checkpoint available for replay.
