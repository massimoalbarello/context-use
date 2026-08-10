# Diary composer

Compose the owner's diary from what has been written to this knowledge base. Every other
writer records what happened on the relevant entity's `timeline` and stops there; this
automation reads the timelines that changed and assembles each affected day into its log.
It is the only writer of `about/diary/`.

## Authority and boundaries

- After opening this page, call `prepare_knowledge_write` for
  `automations/diary-composer/instructions` to load the [[agents|root guide]] and
  applicable [[automations/agents|automation guide]], begin the run's guidance cache, then
  read [[automations/diary-composer/state|state]]. The installed guides, including local
  edits, are authoritative.
- Before the first write, call `prepare_knowledge_write` for the exact day path and follow
  its root-to-leaf guide chain. Reuse the receipt for later days with the same chain, and
  pass it as `cached_guidance_receipt` when preparing a target that may add local guidance.
- Write only under `about/diary/`. Never create, update or archive an entity page, a
  `timeline` or another automation's material. This automation reads those and links to
  them; the link runs one way.
- Never write a cursor, scan log, record identifier or other operational metadata into the
  knowledge base.

## Read the change window

1. Read the state page. When its checkpoint is `_none_`, omit `cursor`; otherwise pass the
   exact opaque value without interpreting it.
2. Call `get_knowledge_changes` with that cursor. When `has_more` is true, call again with
   `next_page_token` as `page_token` and no cursor, until `has_more` is false. The window
   is fixed by the first call, so pages changed while this run works remain for the next.
3. Ignore rows this automation wrote. Ignore `deleted` rows unless the deletion leaves a
   day's log asserting something that is no longer there.

The remaining rows split by path, and the two halves answer different questions.

- **Paths ending in `/timeline`** carry what happened. Read each one's current body and
  take its timeline events dated inside the coverage window below. A timeline that did not
  change cannot have gained one, so the rest of the base needs no reading.
- **Every other path** says only that something was written, and when. Use it for the
  writing-up case below and for the gap check. Do not narrate page maintenance: a page
  reshaped, relinked or corrected without a timeline event is not something that happened
  to the owner, and it never reaches the diary.

## Check for entities that recorded nothing

Comparing the two halves costs no extra reading, and it catches the one failure this
design cannot otherwise survive: a writer that recorded a real occurrence on the entity's
pages and forgot its timeline event. Nothing downstream can repair that. A canonical page
carries no dated status by design, so once the timeline event is missing the date is not
anywhere to recover — only the writer ever had the evidence.

So detect it and say so. For each entity folder with a changed page in this window whose
timeline recorded no event dated inside it:

- Name it in the run report as a gap, with the path and the day its page changed. The
  repair belongs at the source, on that entity's timeline.
- Where the change was a newly created entity, or a rewrite whose content plainly
  describes something the owner did, mention it in the log for the day the page changed —
  as what it honestly is, that the owner recorded or worked on this subject, never as a
  dated occurrence invented to fill the gap. Link the entity.
- Where the change altered only wording, links, headings or placement, leave it out of the
  diary entirely. It still belongs in the gap list if the page describes an occurrence.

This is a net, not a second source. Prefer one accurate line over a reconstruction, and
never guess a date the evidence does not carry.

## Coverage window

A run may create or revise the thirty days preceding it, matching the source freshness
boundary the [[automations/activity-distiller/instructions|activity distiller]] works to.

A timeline event dated before that window is historical: a project written up long after
it ran, a book finished years ago, a conference recorded from an old note. It belongs on
its entity's timeline at its own date and creates no diary day in the past. What it does
create is one line under the day it was written, because writing it up is itself something
the owner did: *wrote up [[about/projects/…|the first iteration]] today*.

## Assemble each day

Take every timeline event dated to the day, from every timeline in the worklist, and write
the day's `log` under the [[about/diary/agents|diary guide]].

1. Write the narrative from what those events say, linking each entity at its `intro`
   rather than at its timeline. The events are the evidence; the log is prose, not a list
   of them.
2. Fill `Threads` with the projects and tasks that moved, adding a continuity link where
   the day's work resumes an earlier one.
3. Never write `On my mind`, and never infer a mood, doubt or half-formed idea from what a
   page says. If the owner did not record an interior state, it is not in the timelines to
   recover.
4. Derive the title and summary from the day's material activity. Do not invent a location.

Revise a day only when this window carries a timeline event dated to it. A day nothing new
was recorded for stays exactly as it is.

Reconcile rather than append. On a rerun the events are read again from the current
timelines, so rewrite the day into one coherent account instead of adding a second pass
over it. Preserve every sentence the owner wrote, `On my mind` in full, and any page in the
day folder this automation did not create.

Create no log for a day whose events carry nothing worth recording. A valid run may
update only the checkpoint.

## Checkpoint and report

Writes must be replay-safe, because a failed state update returns the window on the next
run. Re-reading current timelines is naturally safe: it derives the same day from the same
events rather than accumulating.

After every intended write succeeds, replace the state body with exactly:

    # Diary composer state

    **Checkpoint:** `<next_cursor>`

Keep the state's existing title and summary. Save the checkpoint even when the run made no
semantic change. If a write or the state update fails, leave the old checkpoint in force,
stop, and report the failure.

Finish with:

- the days created or revised, and whether the change ledger is caught up;
- a concise summary and any unresolved ambiguity, including any timeline event whose date
  could not be read;
- `Created` and `Updated` lists naming every day log written, each with its exact path and
  a short description;
- `Recorded nothing dated` listing each entity whose pages changed in this window while its
  timeline gained no event, so the owner can put the date back where it belongs.

Write `None` for an empty list.
