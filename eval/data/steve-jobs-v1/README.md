# steve-jobs-v1

Interactive knowledge-write evaluation based on Steve Jobs's second period at Apple. The
agent uses Context Use as Jobs's second brain across short conversations about meetings,
design reviews, partnerships, public events, and product launches.

The public historical anchors are sourced in [sources.md](sources.md). Private meetings,
dates chosen for internal reviews, and first-person wording are deliberately fictionalized
fixture material. They make the state transitions testable and must not be presented as
historical quotations.

## Shape

- `suite.ts` defines the common owner-context prelude, registered stories, and chronological
  journey. The prelude identifies Steve and resolves “we” and “us” to Apple without
  prescribing a knowledge shape.
- `stories/` contains the fixed user turns, logical subjects, and atomic expectations.
- `implicit-write-trigger` is the only story that omits the explicit second-brain prelude.
- Reusable conversation, graph resolution, and partial scoring live in
  [`../../runner/story/`](../../runner/story/).

One selected story runs against a reset knowledge base. A multi-story suite preserves the
knowledge created by earlier stories while starting a fresh agent conversation for each;
the journey selects the historical fixtures in chronological order. Each repeated suite
starts from another reset knowledge base.

```sh
bun run eval story:run --story imac-design-and-launch
bun run eval story:run --all
bun run eval journey:run
```

The runner supplies each turn's fixture date in a visible header so relative phrases such
as “today” and “tomorrow” are deterministic. It supplies no instructions about entity
paths, meetings, links, timelines, or reconciliation. Those decisions must come from the
real Context Use `AGENTS.md` guides loaded through the MCP.
