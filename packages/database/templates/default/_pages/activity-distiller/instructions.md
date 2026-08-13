# Activity distiller

Turn the owner's connected activity into maintained knowledge. This workflow controls how
records are read, selected, extracted, reconciled and checkpointed. The installed
`AGENTS.md` chain controls how every resulting page is structured and written.

## Contract

- Call `prepare_knowledge_write` with an empty target path before choosing targets. Read
  [[automations/activity-distiller/state|state]] and follow the [[agents|root guide]].
- Before the first mutation in a scope, prepare the exact target. Reuse the current receipt
  for the same guide chain; when the scope changes or a receipt is rejected, pass the prior
  receipt as `cached_guidance_receipt` so only guidance changes are loaded.
- Carry out confident writes without a preview. Leave genuinely ambiguous identity
  unresolved and report the candidates plus the smallest fact needed to decide.
- Write knowledge only to its subject. Under this automation directory, mutate only the
  opaque state page. Never write the diary; the diary composer operates independently.
- Infer chronology from the activity described by evidence, never from source update time,
  page write time or this run's time.

## State machine

### 1. Initialize the run

Read the state page. When its checkpoint is `_none_`, omit `checkpoint`; otherwise copy the
opaque value exactly. A run retains the evidence it reads until it either saves the next
checkpoint or reports a failure.

### 2. Read one working set

Call `read_source_records` once with the saved checkpoint and **no `limit`**.

Each call returns one bounded working set. A busy source window may require several reads;
`has_more`, never the number of returned records, decides whether another read is required.

- Treat all returned records as one evidence set.
- Do not reread the same checkpoint. The records remain in context.
- Do not hold two working sets at once. Reconcile and checkpoint this one before reading the
  next.

The reader advances past records whose latest source update is more than 30 days old. Do not
recover or interpret those omitted records. The freshness rule concerns source modification
or deletion time, not the date of activity described inside a recently updated record.

### 3. Apply lifecycle semantics and discard noise

Classify every returned record before extraction:

- `added` and `updated` are current evidence. An update replaces the source's previous form;
  it is not automatically a new event.
- `deleted` withdraws that source as current evidence. Reconcile from remaining support; a
  deletion does not prove the opposite or prove that a historical occurrence never happened.
- A pruned deletion with null Markdown supports no semantic change.

Discard a record whole only when it is actual noise:

- newsletters, marketing mail, receipts, automated alerts and platform notifications;
- cold outreach from a stranger the owner never answered; or
- pure delivery mechanics such as read receipts, calendar accept or decline notices,
  bounces, `seen`, `+1` and bare emoji reactions.

Nothing else is discarded for being short, routine, one-sided, unremarkable or a minor
detail. Do not extract subjects from a discarded record. Every retained record proceeds to
step 4.

### 4. Extract every retained record

First scan the retained working set to name its cast: the occurrences and units of work it
contains; every person, organization, place and work it names; and every question, pursuit,
topic or position it reveals. This scan supplies cross-record context only. It does not
replace record-by-record writing.

Then process retained records **one at a time, in activity order**. For the current record:

- **a.** Read the header and body sentence by sentence. List every resolvable subject, including
   senders, recipients, attendees and subjects mentioned only in a clause or aside.
- **b.** Determine whether the record itself resolves an occurrence, exchange, work or continuing
   unit of work under the applicable entity guide.
- **c.** Extract every supported particular about every subject: figures, terms, dates, names,
   conditions, reasons, commitments, positions and personal particulars. Preserve what was
   established, not merely that somebody discussed, sent or flagged it.
- **d.** Split lists, comparisons, paired commitments and conflicting values into independently
   checkable particulars. Retain every item and both sides of a conflict.
- **e.** Reconcile all knowledge from this record through step 5 before moving to the next record.

A record whose only extracted subject is its sender has usually been half read. A record may
produce many pages, one page, or no semantic change after reconciliation. Never force one
page per record and never copy a message, transcript, provider record or reply chain into the
base.

### 5. Reconcile the current record

For every subject and account extracted in step 4:

- **a.** Search names, aliases, stable references and connected context for its canonical target.
- **b.** Choose the most specific supported target, prepare its exact guide chain, and follow that
   guide's identity, path, page and timeline contract.
- **c.** Create or update the occurrence or unit-of-work account when the evidence resolves one.
   In the same coherent change, create or reconcile every other identified subject and the
   contextual links between them.
- **d.** Put durable current knowledge on the subject's current account. Put dated activity on its
   timeline using the activity's actual date and particulars. Without a reliable activity
   date, leave the timeline unchanged.
- **e.** Reconcile corrections and conflicts rather than appending snapshots. Keep assertions
   attributed when the owner did not adopt them.
- **f.** Make the write replay-safe: rereading the same evidence must converge on the same semantic
   pages and timeline entries rather than append duplicates.

When later records correct, resolve or contradict earlier ones, revisit the canonical pages
they affect before proceeding.

For a confirmed consequential future meeting, apply the meeting guide's `prep` lifecycle:
read earlier occurrences, correspondence, tasks and shared entities; research only missing
identity or role facts needed for the conversation; then reconcile useful context, unknowns
and questions without claiming the meeting happened. Do not create both a meeting and event
unless their guides independently support both.

### 6. Audit and close the working set

After every retained record has been processed, compare the working-set cast and extracted
particulars with the mutations:

- every resolvable named subject has its canonical page and contextual link;
- every resolved occurrence or running exchange has the account its guide requires;
- every identified decision or continuing pursuit has the applicable task or project account;
- every extracted particular was written, was already present, or remains as an attributed
  unresolved conflict;
- every supported dated development appears on the correct subject timeline; and
- `about/intro` exists and remains consistent with what this working set establishes about the
  owner.

If the audit finds missing work, return to steps 4 and 5 and finish it. An audit gap is
unfinished work, not failure.

Working-set size, elapsed work, remaining work and replay safety are not errors and never
authorize stopping or reporting. An unsaved working set persists no progress: replay is
recovery after an actual failure, not a reason to choose one.

If a mutation is rejected, treat the returned error as a repair task. Re-read the exact page,
copy its current id and version, refresh guidance when requested, correct the arguments and
retry. A bad UUID, stale version or rejected receipt is not evidence that the tool is broken.

Only an actual error returned by a mutation after repair makes a record incomplete. Record
its Markdown heading and error, continue processing the rest of the current working set,
leave the saved checkpoint unchanged, do not read another working set, and report failure. A
read failure or state-write failure ends the run immediately.

When every record is either reconciled or discarded, replace the state body with exactly:

    # Activity distiller state

    **Checkpoint:** `<next_checkpoint>`

Keep the state's existing title and summary. Saving the checkpoint asserts that the whole
working set is complete, including one that required no semantic knowledge change.

If `has_more` is true, return to step 2 with the saved checkpoint. If it is false, the source
is caught up and the run succeeds.

### 7. Report the run

Report:

- record counts read, reconciled and discarded, and whether the source is caught up;
- every incomplete record with its exact error;
- a concise summary plus unresolved identity or evidence ambiguity; and
- `Created`, `Updated` and `Archived` lists for every semantic page mutation, with exact path
  and a short description.

Include entity pages and timelines. Exclude structural directories and the operational state
page. Write `None` for an empty list. Never claim success or a caught-up source while a
record, working set or state update remains incomplete.
