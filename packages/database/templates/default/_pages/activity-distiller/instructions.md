# Activity distiller

Maintain this knowledge base from the owner's connected activity. Turn evidence from
GitHub, email, meetings and other services into connected, durable knowledge about what
matters to the owner. This is curation, not ingestion: provider records are evidence, not
pages to mirror.

Curation decides which records are worth writing about. It does not summarise the ones it
keeps. What a kept record establishes — the figure, the term, the date, the name, the
reason — is the knowledge the owner comes back for, and a page saying that a conversation
happened, in place of what the conversation established, has kept the record and lost the
point of keeping it.

Both failures are equally available and this automation is the only thing standing between
them. Mirroring the source produces a feed nobody can read; smoothing it produces a base
that knows a deal was discussed and not what was offered. The root guide's
[[agents#curate-do-not-filter|distinction]] is the one to hold: leaving out a record is a
decision this automation makes constantly, and leaving out a detail of a record it kept is
one it should almost never make.

## Authority and boundaries

- After opening this page, call `prepare_knowledge_write` with an empty target path to
  load the [[agents|root guide]] and begin the run's guidance cache, then read
  [[automations/activity-distiller/state|state]]. The
  [[automations/agents|automation guide]] loads with the checkpoint write, where it
  applies. The installed guides, including local edits, are authoritative.
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

## One run, one record at a time

A **run** is one trigger: a fresh session, from the first read to the checkpoint that ends
it. Nothing carries over from the last run except the checkpoint, and everything read
inside this one stays in context for the rest of it. That is what the unit is for — the
tenth record is judged knowing the first nine, which is the only way a contradiction
between two of them, a reply that settles an earlier question, or the same person under two
spellings is ever visible.

Within a run, records are **read wide and written one at a time**. Those pull in opposite
directions on purpose: reading wide is what makes attention across the whole set possible,
and writing one record at a time is what stops that width collapsing into a summary of it.

1. Read the state page. When its checkpoint is `_none_`, omit `checkpoint`; otherwise
   pass the exact opaque value without interpreting it.
2. Call `read_source_records` with that checkpoint and a `limit` large enough to take
   everything the source has ready, up to what the tool allows. Read wide: a record held
   back is a record the others cannot be read against. Treat all returned records across
   services as one evidence set. `source` and `record_ref` are reasoning provenance only
   and never knowledge content.
3. Name the run's cast before judging any record: the people the owner dealt with, the
   organizations at stake, the open questions they are weighing, the occurrences that took
   place and the positions they argued from. This list is drawn from every record
   returned, because selection decides what is written about and this decides who and what
   is known to exist. Keep it for the rest of the run.
4. Now work through the records **one at a time**, in the order the activity happened.
   For each one:
   - name what it establishes — the figures, terms, dates, names and reasons stated in it;
   - decide whether the record is noise under the selection rules below. If it is, drop it
     and say so; its cast still counts, and the run moves on;
   - otherwise write what it establishes into the knowledge base **before reading the next
     record**, on the pages of the subjects it is about.

   Nothing advances past a record while something it established is still unwritten. This
   is the whole point of the loop: a run that reads forty records and then writes is a run
   that writes a summary of forty records, and every particular in them is lost at once.

   **One record at a time is an accounting discipline, not a page shape.** Records and pages
   are many-to-many, and the shape follows what the record turns out to be. A meeting note
   becomes that meeting's page, and in the same write updates every participant, company and
   question it touched. A single message becomes one timeline event on a page that already
   exists. Five exchanges over a week become one thread. A record that establishes nothing
   durable becomes nothing at all.

   What is never right is moving a record across. The loop is per record so that nothing is
   missed; the writes it produces are per subject, and each is distilled — read, interpreted,
   placed and linked. A run whose pages line up one-to-one with its records has copied rather
   than distilled, and produced the feed this base exists not to be.

   Later records revise what earlier ones established: a figure corrected, a position moved,
   a name resolved to someone already known. Reconcile the page in place when that happens,
   exactly as the root guide requires.

   A record can be too routine to write about while a fact inside it is worth keeping. What
   fails the selection rules is the record, never the fact.
5. When every record has been written or dropped, check the cast from step 3 against what
   was written, and finish whatever is missing:
   - each conversation that took place has its meeting page, each running written exchange
     its thread page and that thread's `timeline`, each person and organization its own,
     each decision in flight its task page;
   - every material state change is a timeline event on the entity's `timeline`, dated to
     when the thing happened, stating the particulars from step 4 rather than that a
     conversation about them took place;
   - no canonical page carries a dated status, stage or figure that belongs on its
     timeline, and no name sits bare where a link belongs;
   - `about/intro` exists and still describes the owner these records have just shown you.
6. After every intended knowledge mutation succeeds, replace state with this call's
   `next_checkpoint`. If a mutation or state update fails, leave the old checkpoint in
   force, stop and report the failure.
7. When `has_more` is true, read again with the saved checkpoint and repeat from step 3,
   in this same run, so the new records are read against what is already in context. Never
   hold a second unread set of records before the first is written and checkpointed.

A run ends when `has_more` is false, or earlier when it has taken on as much as it can hold
and continuing would mean reading records it cannot attend to properly. Stop there, on a
saved checkpoint, and report that the source is not caught up; the harness starts the next
run in a fresh session and it resumes from exactly that point. Ending a run early costs one
seam in the reading; carrying on past what fits costs the particulars of everything read
after it, which is the failure this whole loop exists to prevent.

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

None of these exclusions turns on who was speaking. A fact reported by someone else about
a subject this base already holds is that subject's, whether or not the owner replied: the
root guide's engagement threshold decides which subjects exist, not what is known about
one that exists already. The first exclusion above is about strangers, not about the
owner's own channels.

An email or chat exchange matters only through the knowledge it establishes—for example, a
substantive reply, commitment, relationship development, decision, or material advance to a
project or task. When it establishes any of those, its account is a
[[threads/agents|thread]], written as fully as a meeting page and on the same terms: named
for the line of work, never for a channel, a counterparty or a provider thread id. Do not
copy message bodies or create correspondence-feed pages.
Several low-value records do not become important merely by accumulation. A valid run
may update only the checkpoint.

These exclusions drop the noise around the owner's activity; they do not shrink the
activity itself. A run carrying the owner's own meetings, decisions, commitments and
working conversations is a substantial run, and reducing such a day to one narrative page
is a failure of the same kind as mirroring every record. They are also the whole of the
filtering: a record that survives them is written up in the particulars it establishes, and
there is no second, quieter filter that decides which of those particulars are interesting
enough to keep.

The test for a record is whether it changes future understanding. The test for the run is
whether someone reading the result afterwards can reach every person the owner dealt with,
every organization at stake and every question they were weighing that day — and find, on
each, what was actually said about it.

## Reconcile connected subjects

Determine targets from the actual subjects the run has read, never from the provider,
record type, repository, email thread or calendar-item shape. Search
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
cast from every record read, discarded ones included, and let the owning guides decide
which of them earn a page. The selection rules above govern what is written about, not who
is known to exist — though they still exclude the stranger's unsolicited message, since
someone who wrote to the owner and got no engagement back is not yet part of that world.

An occurrence is placed by when it happened, not by when a record mentions it: a
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

Writes must be replay-safe because a failed state update returns those records on the next
run. Re-read and reconcile on replay rather than appending duplicates.

Once every record from a read has been written or dropped, replace the state body with
exactly:

    # Activity distiller state

    **Checkpoint:** `<next_checkpoint>`

Keep the state's existing title and summary. Save the checkpoint even when the records made
no semantic change, then discard them before reading again. Never save it while a record
that was kept still has something unwritten: the checkpoint is the claim that those records
are done, and advancing it early loses them silently and permanently.

Success means `has_more` is false. The final saved checkpoint makes the next scheduled
invocation start after the source lifecycle changes covered by this run. Finish with:

- the number of records read, written and dropped, and whether the source is caught up;
- a concise overall summary and any unresolved ambiguity;
- `Created`, `Updated` and `Archived` lists containing every semantic page mutation,
  each with the exact path and a short description.

Include every entity page and timeline in those lists. Exclude structural directories and
the operational state page. Write `None` for an empty list. On failure,
report what failed and leave the prior checkpoint available for replay.
