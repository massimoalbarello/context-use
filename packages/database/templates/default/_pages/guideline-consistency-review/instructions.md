# Guideline consistency review

Review only knowledge pages that changed since the previous successful review and tell
the owner when a changed page no longer follows the guidance that currently applies to
it. Propose the smallest concrete correction, but do not change knowledge during this
automation.

## Authority and harness boundary

- The installed [[agents|root guide]], [[automations/agents|automation guide]], applicable
  descendant guides and owner-created guides are authoritative. Owner edits to pages
  originally installed by the default template are intentional local guidance unless
  the installed guide chain itself says otherwise. Never replace local guidance with a
  remembered upstream template.
- The external harness owns the schedule, previous successful change cursor, retries,
  run history and user-facing delivery channel. It supplies the cursor to the run and
  persists the new cursor only after the complete review has been delivered
  successfully.
- Context-use, not this automation, records the page-change ledger. Never reconstruct
  it from diary entries, page prose, timestamps or agent recollection. Never write a
  cursor, scan log, proposal or review result into the knowledge base.
- This is a read-only review. Never publish, create, update, move, archive or delete a
  page.

## Select the fixed change window

1. Call `get_knowledge_changes` with the opaque cursor supplied by the harness. Omit
   `cursor` only when the harness has no prior successful cursor.
2. When `has_more` is true, call it again with `next_page_token` as `page_token` and no
   cursor. Continue until `has_more` is false. The scan window is fixed by the first
   call, so changes made while the review runs remain for the next run.
3. Treat the returned rows as the complete worklist. Context-use has already collapsed
   repeated changes to the same page within this window to that page's latest change.
   Do not broaden the review to unchanged pages merely because they are nearby or
   linked.
4. A `deleted` row is a durable tombstone, not a page to review. Mention it only if the
   deletion itself creates a clear inconsistency in another changed page; otherwise
   skip it.

The final call's `next_cursor` is the candidate cursor for the harness. Returning or
seeing that cursor is not success: the harness must leave its previous cursor in force
if any page cannot be reviewed, the report cannot be produced, or delivery fails.

## Review each latest changed version

For every non-deleted row, read the exact `page_id` and `version_number` with
`get_page_version`. If retention has removed that exact version, read the current page
with `get_page`, review that newer version, and disclose the fallback in the report.
Call `prepare_knowledge_write` with the first row's path to load its current root-to-leaf
guide chain. Retain the receipt only for this run and pass it as
`cached_guidance_receipt` while preparing later paths so unchanged common guides are not
repeated. Use the returned guidance for review only; never pass these receipts to a
mutation because this automation is read-only.

Check only requirements supported by that installed guide chain, including:

- whether the page's subject belongs at its path and uses the locally required shape;
- whether its title, summary, links and body remain internally coherent;
- whether claims, dates, evidence, uncertainty, privacy and reconciliation follow the
  applicable guidance; and
- whether a changed guide or managed instruction page remains coherent with its parent
  guides and the other changed pages in this same window.

Do not report a preference as an inconsistency. Preserve valid local exceptions, user
language and useful information. Do not compare against an unavailable or remembered
template snapshot. When guidance conflicts, the most specific installed guide wins;
when it is genuinely ambiguous, report that ambiguity instead of inventing a rule.

## Report through the harness

Return a concise report for delivery through the harness-managed user channel:

- `Reviewed`: the number of distinct non-deleted pages reviewed and the fixed window's
  candidate `next_cursor` for the harness;
- `Inconsistencies`: one item per affected exact path, quoting no more source text than
  needed to identify the problem, naming the applicable guide requirement and
  explaining the mismatch; and
- `Proposed changes`: the smallest concrete edit for each inconsistency, including
  replacement wording only when it materially helps the owner judge the proposal.

Write `None` for empty inconsistency and proposal lists. Separate uncertain findings
and state the missing fact or conflicting guidance. Do not claim the cursor was saved
or the report delivered; those outcomes belong to the harness.
