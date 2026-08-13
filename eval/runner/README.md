# Shared evaluation runner

Reusable mechanics live here; fixed corpus data and corpus-specific answer keys do not.

- `corpus/` defines the normalized corpus contract, integrity checks, and production-shaped
  `SourceRecordReader` implementation.
- `qa/` defines public/sealed question shapes, run selection, prompting, answer capture,
  and deterministic scoring.
- [`story/`](story/README.md) defines persistent conversations, path-independent knowledge
  graphs, logical subject resolution, atomic assertions, partial scoring, and story reports.
- `distill.ts` drives any registered corpus through the activity distiller.
- `agent.ts`, `snapshot.ts`, `terminal.ts`, and `text.ts` are shared runtime utilities;
  `workspace/` is the isolated working directory used by agent sessions.

To add an eval, create `eval/data/<id>/` with its fixed inputs and answer key. A
corpus-backed eval adds a `corpus/`, lockfile, loader, and optional `qa/`; an interactive
eval adds stories and a suite manifest. Reusable mechanics belong here, while command
composition belongs in `eval/cli/` so the runner stays independent of command-line policy.
