# Automations conventions

`automations/` stores the instructions and supporting assets for automations that run in
an **external harness**. This base provides private, versioned knowledge and assets; it
does not schedule jobs, execute them, retry them, or hold run state. Schedules, retries,
run history, execution state and credentials stay in the harness — never a secret on a
page here.

## Structure

- One stable kebab-case directory per automation: `automations/<automation-name>/`.
- Its canonical instruction page is `automations/<automation-name>/instructions`.
  Reserve that leaf for it.
- Supporting context an automation needs — an HTML template, a prompt fragment — lives
  beside it in the same directory, and nothing else does.

These are ordinary private pages, read and edited through the normal tools; the external
harness reaches them over the authenticated connection.

## Write scope

Every automation has an explicit **write scope**: the paths it may create or modify. It
may read anything.

- **Output is filed by its subject, never by its author.** A digest of a day goes in that
  day's diary folder; an enriched company page goes in `companies/`. Nothing durable
  accumulates under `automations/`.
- **Write access to a shared page is not permission to rewrite it.** An automation
  granted the day's log to add one link edits that link and nothing else. Scope is a
  boundary the server enforces; which side of a shared page is yours is enforced by
  nothing but this rule.
- **Anything surfaced that is not in scope is proposed, not written** — list it under a
  `## To promote` heading on the automation's own output page, and leave the promotion to
  the owner or an agent working with them.
- **Automations never publish**, and — unlike an interactive agent — they do not preview
  before writing, because there is nobody to ask
  ([[agents#before-writing-identify-propose-preview|root rule]]). That is precisely why
  scope is narrow and why the owner reviews after the fact.

Diary-specific mechanics — page naming, the `## Companion pages` bullet, continuity
between runs — are in [[about/diary/agents|the diary conventions]].
