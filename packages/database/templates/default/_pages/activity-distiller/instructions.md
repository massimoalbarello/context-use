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
   place and the positions they argued from. This list is drawn from every record
   returned, because selection decides what is written about and this decides who and what
   is known to exist. Keep it for the rest of the batch.
4. With the cast, note what each record actually establishes — the figures, terms, dates,
   names and reasons stated in it. A record earns its place through these; they are what
   the owner comes back for, and they are the first thing lost when a batch is summarised.
   A message can be too routine to write about while the number inside it is worth
   keeping: what fails the selection rules below is the record, never the fact.
5. Select the evidence, then reconcile the whole batch — the cast above, its connected
   subjects, and pages changed by earlier batches in this run — before reading again. A
   batch may legitimately produce no semantic change.
6. Before saving the checkpoint, check the cast from step 3 against what was written, and
   finish whatever is missing:
   - each conversation that took place has its meeting page, each person and organization
     its own, each decision in flight its task page;
   - every material state change is a timeline event on the entity's `timeline`, dated to
     when the thing happened, stating the particulars from step 4 rather than that a
     conversation about them took place;
   - no canonical page carries a dated status, stage or figure that belongs on its
     timeline, and no name sits bare where a link belongs;
   - `about/intro` exists and still describes the owner the batch has just shown you.
7. After every intended knowledge mutation succeeds, replace state with this call's
   `next_checkpoint`. If a mutation or state update fails, leave the old checkpoint in
   force, stop and report the failure.
8. When `has_more` is true, read the next batch using the saved checkpoint and repeat.
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
activity. Without a reliable activity date, record what is durable about the subject and
leave the timeline alone rather than dating one by guess.

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

These exclusions drop the noise around the owner's activity; they do not shrink the
activity itself. A batch carrying the owner's own meetings, decisions, commitments and
working conversations is a substantial batch, and reducing such a day to one narrative
page is a failure of the same kind as mirroring every record. The test for a record is
whether it changes future understanding. The test for the run is whether someone reading
the result afterwards can reach every person the owner dealt with, every organization at
stake and every question they were weighing that day.

## Reconcile connected subjects

Determine targets from the actual subjects across the whole evidence batch, never from
the provider, record type, repository, email thread or calendar-item shape. Search
existing knowledge and connected evidence before preparing each unfamiliar exact
target, then let its guide chain decide the useful pages. Apply the root timeline
contract in the same coherent write whenever a timeline event is recorded.

Take the cast named in step 3 to its owning guides and reconcile every subject that meets
the threshold there. Records are how the cast becomes visible; they are not themselves the
subjects.

Two of those lists are the ones that vanish. The **open questions**, because no record is
shaped like a decision: whether to commit, hire, buy, build, accept or decline is a subject
exactly as a person or an organization is, and usually what the owner looks for afterwards
— they remember the argument, not which Tuesday it was had. The **positions**, because
they are never news: when the owner says *our approach*, *what I look for*, *the reason we
said no*, they are reasoning from something they hold and keep applying, and every decision
citing it restates it instead of pointing at it.

Discarding a record does not discard its cast. A message carrying no durable fact still
shows who is in the owner's working world: the colleagues in the channels they belong to,
the counterparty who keeps appearing, the organization everyone is discussing. Build the
cast from the whole batch, discarded records included, and let the owning guides decide
which of them earn a page. The selection rules above govern what is written about, not who
is known to exist — though they still exclude the stranger's unsolicited message, since
someone who wrote to the owner and got no engagement back is not yet part of that world.

An occurrence is placed by when it happened, not by when the batch mentions it: a
conference the owner attended last week, an earlier meeting everyone is following up on, a
call that produced the commitment now being honoured. Several records referring back to one
occurrence is the clearest evidence it mattered.

An occurrence page is half of a write. The people, organizations and questions it names are
the other half — each a page to create or update and link in the same coherent change.

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

## Leave the diary alone

Never create or edit a page under `about/diary/`. Record what happened as a timeline event
on the entity's `timeline` and stop there; the
[[automations/diary-composer/instructions|diary composer]] reads those events afterwards
and assembles each day. A timeline event dated correctly is the whole of this automation's
contribution to the chronology, and a timeline event that links a day log asserts one
that does not exist yet.

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

Include every entity page and timeline in those lists. Exclude structural directories and
the operational state page. Write `None` for an empty list. On failure,
report what failed and leave the prior checkpoint available for replay.
