# Local knowledge-organization evals

These evals test the write path: whether a fresh agent turns successive pieces of
information into a connected knowledge base that follows the default template. They do
not test retrieval.

Each step runs in a new agent session. The only state carried forward is Context Use
itself. Immediately after each step, deterministic checks inspect the database for:

- canonical people and company entities without duplicates;
- contextual links between related entities;
- creation or reconciliation of every expected entity on every step;
- one timeline per materially involved entity;
- the exact daily diary and bidirectional timeline links; and
- a canonical occurrence page for meaningful meetings.

## Run locally with Codex

```sh
bun run eval up
```

Create the owner once at the setup URL printed by that command using
`eval@example.com`. Then connect the installed Codex CLI once:

```sh
bun run eval connect codex
```

Run the scenario whenever wanted:

```sh
bun run eval run
```

Every run resets semantic knowledge and assets to the default template while preserving
the owner passkey and OAuth authorization. Reports and snapshots are written under
`.eval-results/`.

The terminal shows readable write progress and per-step scores. Keep the dashboard open
at `http://localhost:5273/app/` to watch the knowledge tree update during the run.
Complete agent JSONL, stderr, final messages, per-step database snapshots, and the
baseline snapshot remain in the run directory for debugging.

Scoring is deterministic and does not use model credits. After changing the assertions,
rescore the latest saved snapshots—or a specific run—without rerunning the agent:

```sh
bun run eval score
bun run eval score 2026-08-07T14-14-46-829Z-codex
```

Use `bun run eval destroy` to remove semantic data and stop the stack while preserving
authentication, or `bun run eval purge` to remove everything, including the passkey.

## Claude Code

Claude Code uses the same scenario and scorer:

```sh
claude auth login
bun run eval connect claude
bun run eval run --provider claude
```

Claude's MCP authorization is managed by Claude Code and may require approving the
localhost server with `/mcp` in an interactive Claude session before the first run.

## Fixture attribution

The fictional Amara, NovaMind, Chen Wei, Derek Lin, and Marcos Reyes trajectory is
adapted from [`garrytan/gbrain-evals`](https://github.com/garrytan/gbrain-evals), used
under its MIT License. The fixture is intentionally rewritten and reduced to the facts
needed to test Context Use's semantic and temporal organization.
