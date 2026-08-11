# Diary composer

Compose the owner's diary from activity already written to the knowledge base. The durable
pages say what each subject is and the timelines carry the particulars of what happened.
This automation writes the connective layer: linked prose showing how the activities
formed a day and how genuine lines of work continue across days, without copying the
entity pages into a second account.

Run on its own schedule. Never read, wait on or mutate another automation's instructions or
state, and never use another automation's checkpoint or report as a precondition. The fixed
knowledge-change window is the whole input to this run. If another writer adds timeline
events while composition is underway, those changes remain after the saved cursor for the
next scheduled run, which reconciles them into the day then.

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
  log, write around the existing text. Use page history when authorship matters, and treat
  any passage whose ownership remains unclear as the owner's. Access to the diary never
  grants ownership of all its words.
- Never put a cursor, scan log, page identifier, run report or other operational metadata
  in a day folder.

## Read one fixed change window

1. Read the state page. When its checkpoint is `_none_`, omit `cursor`; otherwise pass the
   exact opaque value without interpreting it.
2. Call `get_knowledge_changes` with that cursor and no `limit`. When `has_more` is true,
   call it again with `next_page_token` as `page_token` and no cursor. Continue until
   `has_more` is false. The first call fixes the window, so changes made during this run
   remain for the next one.
3. For every timeline row, read its returned exact `page_id` and `version_number` with
   `get_page_version`. If that immutable version is unavailable, read the current page and
   disclose the fallback in the report. A timeline is either a path ending in `/timeline`
   or a promoted year page beneath `/timeline/`.
4. Rows under `about/diary/` and `automations/diary-composer/` are not activity inputs.
   Read existing day pages later when their day is affected, but do not narrate their edits.
   Every other non-timeline row is context only: it may be read when a timeline links it,
   but the fact that an entity page was created or revised is not something the owner did.

After the activity distiller's identifiability rule, a kept record can create many entity
pages merely because it names many subjects. **A changed entity page with no timeline event
is therefore not a diary gap.** Do not report one, turn page maintenance into a diary item
or invent a date for it. The distiller owns its own timeline completeness check; this
automation trusts the chronology it receives.

A deleted timeline row or a correction can invalidate prose already composed. For an
affected entity, inspect recent day pages that link it and reconcile only the passages the
remaining timeline evidence no longer supports. Deletion is withdrawn evidence, not proof
that the opposite happened.

## Choose the affected days

The composer may create or revise days in the rolling thirty-day window ending on the run
day. This is the diary's revision horizon, not an interpretation of the distiller's
source-freshness rule: a recently modified source can describe older activity.

Collect every timeline event in that horizon from the changed timeline versions. The dates
of the events, never their page-change timestamps, choose the day. An older event remains
on its entity's timeline but does not cause an old diary to be created merely because an
automation wrote the page today. A knowledge write is not owner activity.

Timeline events have already passed the activity distiller's selection and root timeline
rules, so do not filter them a second time for looking routine, small or repetitive. Every
distinct activity they establish belongs in its day. Repetition across timelines is the
exception: the same meeting, exchange, decision or movement recorded from several entity
sides is one activity with several useful links, not several diary beats.

Revise a day when the window contains an event dated to it, or when a correction or
deletion in the window removes support for a passage in it. A day unaffected by the window
stays exactly as it is. A valid run may therefore update only the checkpoint.

## Build the day's connected evidence

For each affected day:

1. Group its timeline events into distinct activities. A shared occurrence link, date,
   participants, terms or outcome can show that several lines describe the same activity.
   Collapse only what the evidence actually joins; two things on the same date are not one
   thing for that reason.
2. Read the current log and every companion view it reaches. Existing diary prose is the
   account of activity composed in earlier windows; integrate new evidence with it rather
   than rebuilding from only the latest ledger rows and erasing the rest. When a page has
   more than one writer, use `get_page_history` as far as needed to distinguish the
   composer's prior material from owner additions. Preserve uncertain passages.
3. Read linked occurrence pages and the smallest amount of current entity context needed
   to identify the relationship and choose the useful destination link. Do not mine those
   pages for facts to repeat in the diary. The timeline event tells what moved; the entity
   pages tell where the detail lives.
4. Use `browse_directory` on the relevant year or month to find the latest earlier diary
   day, and use `search_pages` with the canonical subject path to find the most recent
   diary page connected to each project, task, thread or other arc that genuinely
   continues today. Follow existing continuity links when they lead to the nearer context.
   Reading an earlier page is evidence for a link, not a requirement to manufacture a
   continuation.

When two activities remain unrelated after that reading, keep them unrelated. Their place
on the same date is chronology, not causality.

## Compose prose and views

Write the affected day under the [[about/diary/agents|diary guide]]. Let its material choose
the shape; no section or heading is mandatory.

- Make `log` the prose entry point. Tell the transitions, consequences and open threads
  that make the day intelligible, not one bullet or sentence per timeline event.
- Represent every distinct activity, linking its most specific occurrence and the durable
  subjects that route a reader to what it established. Name a subject once as a link under
  the root rule. Do not duplicate the figure, terms, biography or reasoning held on those
  pages unless one particular is necessary to understand what changed next.
- Where evidence establishes a real relationship between activities, make the connection
  explicit. Where it does not, use separate paragraphs, descriptive headings or separate
  day views. Never invent a theme, causal transition or mood merely to smooth the prose.
- Link genuine continuations inline to the latest useful earlier diary page. Repeated
  mention is not continuation, and chronological adjacency needs no link. Never edit the
  earlier day to add a forward pointer.
- Include thoughts, feelings and first-person positions only when the evidence records
  them as the owner's. Preserve owner-written material even when its voice or structure
  differs from the composed prose, and build around it without silently paraphrasing it.
- Keep one `log` when it reads well as one page. Create a descriptively named companion
  view only when its day-specific material is independently worth reading or interrupts
  the log. Link it from the log in context and connect it directly to any other view it
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
  and any unresolved ambiguity or unreadable timeline date; and
- `Created`, `Updated` and `Archived` lists naming every diary page mutated, each with its
  exact path and a short description.

Exclude structural directories and the operational state page. Write `None` for an empty
list.
