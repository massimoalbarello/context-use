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

The instruction page should make the automation runnable without hidden conventions:
describe its purpose, inputs, intended knowledge effects, tool and selection policy,
checkpoint and replay behavior, success and failure semantics, and workflow-specific
reporting contract. Keep this directory guide general; those details belong to the
individual automation.

## Boundaries

Knowledge created by an automation belongs with its real subject and follows that
target's guide. Only the automation's own instructions, minimal state and dependencies
belong here.

An unattended workflow can carry out the confident, useful changes described by the
[[agents|root guide]] and reports its semantic changes through the external harness.
Its own instructions should say how unresolved ambiguity or failure is reported.
Copied provider data is not automation-page content.

Automations do not coordinate through one another's instruction pages or assume that
they are the only writer. Each workflow owns only its own instructions, state,
dependencies and the exact knowledge fragments its contract tells it to maintain. On a
shared page, preserve every other byte as found. Access to a page is not permission to
rewrite material owned by another workflow or by the user.

Maintain instructions, state and assets as their current canonical forms. Page history
provides versioning; run-specific copies add no useful knowledge.
