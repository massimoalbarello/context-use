# Automations conventions

Follow the [[agents|root guide]] for every convention not specific to automations. This
guide adds only how the `automations/` directory is laid out.

`automations/` holds the versioned instructions, minimal durable state and true supporting
assets of jobs run by an **external harness**. The harness owns scheduling, execution,
retries, credentials and run history.

## Suggested shape

    automations/<automation-name>/
    ├── instructions  — the canonical operating contract
    ├── state         — an optional opaque incremental checkpoint
    └── <asset>       — a prompt fragment, template or other real dependency

- A stable kebab-case directory gives an automation a durable identity.
- `instructions` is the useful default leaf for its canonical operating contract. This is a
  local exception to the root `intro` entry-point convention: the harness addresses
  `instructions` directly, so do not add a redundant `intro` page.
- Incremental workflows may use one stable `state` page holding only the current opaque
  checkpoint and, when useful, the last successful completion time.
- Supporting assets sit beside the instructions only when the automation actually consumes
  them.

## What does not belong here

Only an automation's own instructions, state and dependencies. Run logs, retry histories,
source records, dated checkpoint pages and copied provider data are the harness's business
and have no page here.

Knowledge an automation produces is not automation content either: it belongs to its
subject, under that subject's guide. An automation never files output beneath its own
directory or under a date, because output organized by the process that made it is
unreachable from the subject it is about.

How an automation actually works belongs to its own `instructions` page rather than to this
guide, and that page should make it runnable without hidden conventions.
