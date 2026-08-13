# Shared evaluation runner

Reusable mechanics live here; fixed corpus data and corpus-specific answer keys do not.

- `corpus/` defines the normalized corpus contract, integrity checks, and production-shaped
  `SourceRecordReader` implementation.
- `qa/` defines public/sealed question shapes, run selection, prompting, answer capture,
  and deterministic scoring.
- `distill.ts` drives any registered corpus through the activity distiller.
- `agent.ts`, `snapshot.ts`, `terminal.ts`, and `text.ts` are shared runtime utilities;
  `workspace/` is the isolated working directory used by agent sessions.

To add a corpus-backed eval, create `eval/data/<id>/` with a `corpus/`, lockfile, loader,
and optional `qa/`, then register its id, upstream pin, and loader in `corpus/`. Command
composition belongs in `eval/cli/` so the reusable modules stay independent of command-line
policy.
