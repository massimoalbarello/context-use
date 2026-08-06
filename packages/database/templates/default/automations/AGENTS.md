# Automations conventions

`automations/` stores the instructions, minimal durable state and supporting assets for
automations that run in an **external harness**. The harness schedules and executes jobs
and owns retries and run history. This base supplies versioned instructions, knowledge
and one safe place for an opaque checkpoint. Credentials never belong on a page.

## Structure

- One stable kebab-case directory per automation: `automations/<automation-name>/`, as
  [[agents#entities-are-folders-and-views-are-pages|every entity gets]].
- Its canonical instruction page is `automations/<automation-name>/instructions`.
  Reserve that leaf for it. This directory names its entry point `instructions` rather
  than `intro`, because the page is addressed by the harness, not read as an
  introduction.
- When incremental input requires it, use exactly one stable
  `automations/<automation-name>/state` page. It contains only the current opaque
  checkpoint and, if useful, the last successful completion time. No dated state pages,
  record ledger, retry log or copied source material.
- Supporting context an automation needs — an HTML template, a prompt fragment — lives
  beside it in the same directory, and nothing else does.

**`state` is the one place in this base that holds mutable state**, the stated exception
to [[agents#durable-pages-and-the-diary|the root rule]]. It survives only because it is
machine-owned, overwritten in full on every successful run, and never read as a claim
about the world. Nothing else here carries a status: an automation that has not run is
not a fact about the automation, and an automation's history belongs to the harness.

Maintain each instruction page as the canonical description of that automation. It
should state the automation's purpose, inputs, intended knowledge effects, success and
failure semantics, and reporting contract precisely enough for the external harness to
run it without relying on undocumented conventions. Workflow-specific tool calls,
selection policy and replay behavior belong on that page, not in this directory guide.

Rewrite instructions and state in place as their canonical account changes. Remove
obsolete supporting assets instead of accumulating revisions or run-specific copies.

These are ordinary private pages, read and edited through the normal tools; the external
harness reaches them over the authenticated connection. The harness still owns the
schedule, credentials, process health and operational history.

## Knowledge boundaries

- Knowledge produced by an automation follows [[agents#where-a-page-belongs|the root
  placement rule]] and the target directory's guide. Nothing belongs under the
  automation merely because the automation produced it; this directory contains only
  its instructions, minimal state and true support assets.
- **An automation maintains the timelines it touches.** When its write records something
  that changed an entity's state, the dated line goes on that entity's `timeline` in the
  same write, exactly as an interactive agent would add it.
- **Access to a shared page is not permission to rewrite someone else's material.** An
  automation that adds its companion link to the day's log edits that link and nothing
  else.
- **Uncertain or unsupported proposed knowledge is reported through the external
  harness**, not written into the diary or state.
- An unattended automation is the root guide's preview exception because there is nobody
  to ask ([[agents#before-writing-identify-propose-preview|root rule]]). Its instructions
  must therefore state its intended effects and maintenance policy precisely.
