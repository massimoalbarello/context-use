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
- The external harness owns the invocation schedule. Do not assume a run time, cadence
  or time of day; use the dates and times in the source evidence only to understand the
  underlying activity.
- Never publish. Do not preview unattended writes. If identity, placement or a claim is
  too ambiguous to resolve after the research required below, leave the affected
  knowledge unchanged and ask the owner through the harness. Include the likely
  candidates and the smallest specific fact needed to disambiguate them.

## Process one batch at a time

1. Read the state page. When its checkpoint is `_none_`, omit `checkpoint`; otherwise
   pass the exact opaque value without inspecting or editing it.
2. Call `read_source_records` exactly once with that checkpoint. Treat every returned
   record across every service as one evidence set for this batch. `source` and
   `record_ref` are provenance for reasoning only and never belong in knowledge.
3. Search and reconcile existing knowledge for the complete batch before reading again,
   including pages changed by earlier batches in this run. Do not accumulate a second
   unread batch. A batch with no material evidence, including one containing no returned
   records, legitimately makes no semantic change.
4. Only after every intended knowledge mutation for this batch succeeds, replace the
   state page with this call's `next_checkpoint`. If any mutation or the state update
   fails, leave the previous checkpoint in force, stop the run and report the failure.
5. When `has_more` is true, call `read_source_records` again with the checkpoint just
   saved and repeat this sequence. Continue until `has_more` is false. Never read the
   next batch before the current batch has been reconciled and checkpointed.

On every call, the reader omits records whose latest source update is more than 30 days
old and advances past them. This rolling boundary applies to existing backlogs as well
as newly discovered streams; do not recover or interpret excluded records. It is about
source modification, not the date of the activity described inside the Markdown:
process a recently updated record about older activity normally and use its actual
activity date. For a deletion, the deletion modification time determines freshness.

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
needed to explain current state. Apply a high bar to high-volume streams: importance is
shown by the owner's substantive participation, a consequential relationship, a durable
decision or fact, a real commitment, or a connection to an already important subject.
Volume, recency and availability are not importance. A valid run may update only the
checkpoint.

- Ignore unsolicited messages the owner does not meaningfully engage with, newsletters,
  receipts, platform notifications, automated alerts, cold outreach, acknowledgements,
  routine scheduling and administrative mail by default. Do not create people or
  companies merely because they appear in an inbox.
- Preserve an email thread only through the knowledge it establishes. Prefer threads in
  which the owner replies substantively, makes or receives a meaningful commitment,
  develops an important relationship, explains their work or thinking, reaches a
  decision, or materially advances an existing project or task. Never copy an email body
  or create an email-thread page merely to summarize correspondence.
- Routine commits, ordinary reviews and repeated corroboration are also omitted unless
  their effect was consequential. Several low-value records do not become material by
  accumulation.

## Build connected knowledge

Treat every provider record as evidence about subjects, never as the subject or the
shape of the output. This must continue to work as new source types are connected: apply
the same selection, identity, placement and reconciliation rules regardless of the
provider or record schema.

For each material fact or occurrence, identify the smallest set of canonical subjects
needed to represent it coherently. Reconcile existing pages before creating missing
ones, then add the links required to make the knowledge navigable in both directions
under the applicable guides. A person may link to their company and a meeting; that
meeting may link to a project or task; the relevant relationship timelines may link
back to the occurrence. These are one connected knowledge change, not independent
source summaries. Create only the pages that independently clear their own guide's
threshold, and never invent a weak entity merely to complete the graph.

Material historical evidence and newly arriving evidence may both justify **creating**
canonical entities, not only updating entities that already exist. This includes a
substantive email exchange or evidence from any other high-signal source. Creation is
appropriate when the subject is independently useful, its identity is resolved, the
existing knowledge base has been checked for aliases or duplicates, and the new page
can be connected to the interaction and the other relevant canonical subjects in the
same change. The underlying interaction does not need to be recent when its evidence is
present in a returned source record; use the actual activity date and reconcile it with
what is known now.

## Identity gate for new entities

Do not create an entity from a label or provider record alone. For every candidate new
entity, call `prepare_knowledge_write` for its intended target and read the complete
root-to-leaf guide chain **before deciding that creation is allowed**, not merely before
performing the write. The owning directory guide defines that entity type's identity,
creation threshold, structure and aspects; for example, follow [[people/agents|People]]
for a person and [[companies/agents|Companies]] for a company. Do the same for every
other target type rather than generalising the person or company schema to it.

Use source evidence, existing knowledge, other connected sources and reliable public
research together to satisfy the applicable guide and rule out aliases, namesakes and
duplicates. Put identifying facts in the aspects prescribed by that guide, then link the
new entity to the material email, meeting, event, diary entry, project, task or other
canonical subject that made it relevant. If the guide's minimum identity cannot be
established after research, make no entity page and ask the owner through the harness
with the likely candidates and the exact missing fact.

## Prepare from future signals

Evidence of a consequential future interaction, commitment or occurrence is a trigger
to gather the context that will be useful beforehand, even when it comes from a future
source type. Research and reconcile the relevant existing subjects without recording
the future activity as though it already happened.

Treat a confirmed upcoming meeting as a proactive research trigger, including meetings
later than the current day. A calendar-shaped record is not automatically a meeting:
classify it by the occurrence's actual subject under [[meetings/agents|Meetings]] and
[[events/agents|Events]]. The provider's label does not override those guides. Do not
create both occurrence types unless each independently meets its own guide and the pages
can link without duplicating their accounts.

The calendar entry itself is not diary activity. It does not justify an `intro` page for
a meeting or event that has not happened. A substantive upcoming meeting may justify
creating or updating its `prep` page because that page is explicitly written beforehand;
an upcoming event has no equivalent default prep page, so update only independently
justified related knowledge until evidence supports an event page under its guide.

For each such meeting:

1. Resolve every external participant against existing people and companies, searching
   aliases, email addresses, domains and linked entities before considering a new page.
2. Search connected evidence for earlier meetings, substantive email exchanges,
   introductions, commitments and shared projects or tasks. Read the canonical pages
   those records point to so the result reconciles with what is already known.
3. Research missing public identity and current-role facts using reliable sources such
   as an official company site and a clearly matching professional profile. Cite those
   sources on the claims they support, date changeable facts and retain only background
   useful for this relationship or conversation.
4. Reconcile the smallest connected set of people, company, relationship and, when
   justified, meeting prep pages. Link them to one another and to prior canonical
   meetings, events, diary entries, projects and tasks instead of repeating their
   content. The prep page should surface why the meeting matters, relevant relationship
   history and useful questions or unknowns; it is not a research dossier.

Create participant and company entities only when the upcoming substantive interaction
makes them independently useful and they satisfy their respective guides. If a required
identity still cannot be established, do not create the uncertain entity or a meeting
page that requires it. Ask the owner through the harness only after doing the available
research, and group all ambiguities for the meeting into one concise question.

## Reconcile existing knowledge

Search before creating. Read recent diary pages and every plausible canonical subject,
including aliases and nearby pages, before deciding where evidence belongs. Search
across services when one source identifies a subject in another: calendar participants,
email correspondents, earlier meetings or events, and public research should converge
on the same canonical entities. A repository, email thread, calendar item, record type
or provider boundary does not define a knowledge page.

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
- Write nothing for a date with nothing important enough to remember. For every date
  that does receive an activity-distiller page, ensure its required `log` exists. If the
  `log` is missing, create it after the activity page using the diary guide's title and
  summary rules; its body contains only the title and a `## Companion pages` section
  with this automation's single bullet. Derive the summary and bullet from the material
  activity, and do not invent a location, narrative, `On my mind` or `Threads` content.
- Whether the `log` is new or existing, this automation's share of it is one bullet under
  `## Companion pages`.
- Never put checkpoints, record identifiers, source diagnostics or operational details
  in the diary.

## Creation thresholds and connected updates

- Historical evidence, new evidence and substantive confirmed future interactions can
  all trigger entity creation. For each candidate, apply the identity gate above and the
  target directory's creation threshold. A provider record type, isolated identifier,
  repeated low-value evidence or a desire to complete a graph never overrides the guide.
- Follow the target guide for what content belongs on the new or reconciled page. The
  distiller selects material evidence and coordinates the connected write; it does not
  redefine the schemas for projects, tasks, people, companies, meetings, events or any
  future entity type.
- When a diary entry records a material relationship or project milestone, update the
  applicable curated timeline in the same change. A timeline is a sparse index of
  completed milestones, never current status or an exhaustive activity log.

If required connected pages cannot be represented coherently without guessing, keep
only the justified diary activity or make no write and report the ambiguity.

## Commit the checkpoint and finish

Knowledge writes must be replay-safe because a failed state update causes the current
batch to return again. Re-read and reconcile pages on replay; never append duplicate
material.

After every intended knowledge write succeeds, replace the state page body with exactly:

    # Activity distiller state

    **Checkpoint:** `<next_checkpoint>`

Keep its existing title and summary. Save it after every successfully reconciled batch,
including a batch that makes no semantic change. After saving, discard that source batch
before reading the next one.

A successful run finishes only when `has_more` is false. The final saved checkpoint then
ensures the next scheduled invocation receives only lifecycle changes after this run.
Finish with a concise report containing the number of batches reconciled, whether the
source is caught up, any unresolved ambiguity, and a short overall summary of the key
knowledge changes. Report semantic page mutations in two separate lists:
`Created` and `Updated`. Each entry must give the exact page path followed by a concise summary
of what was created or changed on that page, so the report explains both the change and where
it was made. Include every semantic page created or updated during the run, including diary
logs and companion pages, but exclude structural directories and the operational state/checkpoint
page. If either list is empty, state `None`.
