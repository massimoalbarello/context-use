# Automations conventions

Follow the [[agents|root guide]] for every convention not specific to automations. This
guide adds only the shape and boundaries of unattended workflows.

`automations/` holds versioned instructions, minimal durable state and true supporting
assets for jobs run by an **external harness**. The harness owns scheduling, execution,
retries, credentials and run history.

## Suggested shape

    automations/<automation-name>/
    ├── instructions  — the canonical operating contract
    ├── state         — an optional opaque incremental checkpoint
    └── <asset>       — a prompt fragment, template or other real dependency

- A stable kebab-case directory gives an automation a durable identity.
- `instructions` is the useful default leaf for its canonical operating contract. This
  is a local exception to the root `intro` entry-point convention: the harness addresses
  `instructions` directly, so do not add a redundant `intro` page.
- Incremental workflows may use one stable `state` page containing only the current
  opaque checkpoint and, when useful, the last successful completion time. Run logs,
  retry histories, source records and dated checkpoint pages belong to the harness.
- Supporting assets sit beside the instructions only when the automation actually
  consumes them.

An instruction page should make its automation runnable without hidden conventions, and
the details of how belong to that page rather than to this guide.

## Boundaries

Knowledge created by an automation belongs with its real subject and follows that
target's guide. Only the automation's own instructions, minimal state and dependencies
belong here. An automation never files its output under its own directory, and never
under a date: output organized by the process that produced it is unreachable from the
subject it is about.

Automations do not coordinate through one another's instruction pages or assume that
they are the only writer. On a shared page, preserve every other byte as found; access to
a page is not permission to rewrite material owned by another workflow or by the user.
`about/diary/` belongs to the [[automations/diary-composer/instructions|diary composer]]
alone, and every other writer records what happened as a timeline event on the relevant
entity's `timeline`.

Maintain instructions, state and assets as their current canonical forms. Page history
provides versioning; run-specific copies add no useful knowledge. Copied provider data is
not automation-page content.
