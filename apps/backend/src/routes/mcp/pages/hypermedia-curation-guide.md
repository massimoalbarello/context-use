# Hypermedia curation guide

## Purpose

Curate a self-writing autobiography of the user: a living hypermedia representation where the user
and their agents stay in sync about what they have done, think, plan, learn, and become.

Work like a perceptive biographer, not a database clerk. Connect evidence through what it reveals
about the user's priorities, intentions, taste, and change. Do not merely inventory facts. Write
vivid, specific prose without pretending to know the user's mind.

## Understand before modeling

Begin with retrieval and synthesis, not entities or page titles. Learn proactively when information
may be important. Review relevant conversations, memory, authorized services, and workspaces for
evidence of the user's roles, priorities, projects, relationships, preferences, constraints, and
formative experiences or ideas.

Keep the inquiry centered on the user. Knowledge about a topic matters only when evidence
establishes the user's relationship to it. Do not let the first documents found, easiest facts to
extract, or a source system's structure dictate the autobiography.

Before writing, privately synthesize candidates. Weigh personal relevance, future utility,
durability, evidence, confidence, sensitivity, and distinctiveness. Ask whether each could materially
improve a later agent's understanding or decisions. Preserve durable preferences, decisions,
relationships, projects, plans, corrections, and meaningful events. Reject generic knowledge,
unrelated contents, transient chatter, stale details, duplication, secrets, credentials, unsupported
inference, and material easy to collect. Prefer fewer, better-chosen subjects over broad
coverage. This governs selection, not page count; never merge distinct subjects to write fewer pages.

Never turn uncertainty into assertion. Distinguish user statements, another party's report,
evidence, and inference; preserve genuine ambiguity. If evidence is thin, contradictory, or cannot
support a recognizable account, ask focused questions rather than guess. Only after this quality
gate should you design entities and pages.

## Shape useful pages

The autobiography is the graph, not one page. Give each page one subject from its first revision;
never create or accumulate a catch-all page. Connect distinct ideas, relationships, events,
decisions, and lines of thought with explanatory prose.

Name one subject before writing. Split material a reader would retrieve or revise independently. No
truthful `temporalCoverage` is another signal; cross-period synthesis may link narrower evidence.

Build structure bottom-up. An entity is a stable, identifiable referent, not a keyword. Put
meaningful links inside prose that explains each relationship. A page should help someone understand
the user, not prove that source material was processed. Link targets must exist before writing;
create them first and add reverse links later.

Curate rather than append. Use `list_knowledge_pages`, `read_knowledge_page`, `list_entities`,
`read_entity`, `list_assets`, and `read_asset` as relevant to inspect existing context and avoid
obvious duplication; never call this exhaustive.

## Place knowledge in time

`temporalCoverage` describes when the subject occurred or applied, not revision creation. Use `2026`,
`2026-09`, or `2026-09-01`; suffix `?` for uncertain or `~` for approximate; use `date/date` for a
bounded interval and `date/..` only for evidenced ongoing state. Never invent precision. `..` is not
an unknown end; leave unsupported coverage unset and explain nuance in prose.

Give events their actual date or interval. Split unrelated scopes. A cross-period synthesis may span
its evidence, but should state individual dates and link narrower evidence pages. Preserve those
moments: a story is derived from its evidence, not a replacement for it.

Correct past knowledge keeps its past interval. Revise errors; archive only what should leave the
active graph. Do not add a stable/transient label; infer durability later from evidence.

## Revise and archive carefully

Read the current revision before updating. Preserve unrelated and owner-authored content; make the
smallest coherent revision that incorporates new information. On conflict, read the latest version
and reconcile rather than overwrite. Before creating a page, consider whether an existing page fits.

Decomposition is normal curation: create and connect atomic pages, surface inbound references, then
revise sources and archive the mixed page after a user-informed decision.

If active references block archival, explain the blockers to the user. Never edit or archive a
cascade automatically to force success.
