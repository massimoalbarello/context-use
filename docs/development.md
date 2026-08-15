# Development

## Local stack

When working from this repository, the Bun shortcuts manage the stack lifecycle:

```sh
bun run local up       # build, start, and wait until the app is ready
bun run local status   # show the development containers
bun run local logs     # follow their logs
bun run local down     # stop everything but preserve local data
bun run local reset    # erase knowledge/assets, preserve login, and restart
bun run local destroy  # erase knowledge/assets, preserve login, and leave it stopped
bun run local purge    # erase every volume, including owner and passkeys
```

`bun run local up` prints the app and owner-setup URLs when it is ready.

## Integration suites

Database integration suites commit fixtures and clean them up with trigger and foreign-key
enforcement suspended, so they run against a PostgreSQL server of their own and refuse any
database that has not been marked disposable. Start one, run them, and throw it away:

```sh
bun run db:test up     # start, migrate, and mark a disposable PostgreSQL on 127.0.0.1:55432
TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/context_use_test bun test apps packages
bun run db:test down   # discard it
```

The mark is `ALTER DATABASE … SET "context_use.disposable_test_database" = 'true'`, applied by
`bun run db:test mark`, which refuses any database with an owner passkey registered against it.
The local stack above is therefore never eligible: these suites would delete the owner identity
it and the evals sign in with.

## Knowledge evals

Knowledge evals use the same local instance. Start it with `bun run local up` and create its
owner once, then connect Codex and drive the activity distiller over a vendored corpus with your
local ChatGPT subscription:

```sh
bun run eval connect codex
bun run eval distill --window dense --days 2
```

Or run one end-to-end LongMemEval history and QA question:

```sh
bun run eval longmem:list --limit 5
bun run eval longmem:run --case <question-id>
bun run eval longmem:score
```

The corpus is copied verbatim from
[`garrytan/gbrain-evals`](https://github.com/garrytan/gbrain-evals) and served through the
production `read_source_records` tool, one automation run per corpus day, so this exercises the
real ingestion path rather than an eval-only prompt.

Each run resets local knowledge and assets before it starts, so do not keep development data in
this disposable instance. The owner, passkeys, sessions, and MCP OAuth grants are preserved.

Add `--provider claude` after `claude auth login` to use Claude Code instead. Reports, complete
agent logs, and per-run snapshots are written beneath the gitignored `eval/results/` directory.
`bun run eval corpus:verify` confirms a vendored corpus is unchanged; LongMemEval downloads its
pinned 277 MB dataset once into the gitignored `.eval-data/` cache and verifies it on every use.

See [`eval/README.md`](../eval/README.md) for details.

## Knowledge template

New installations receive the Git-versioned default knowledge template. Template changes are
intentionally separate from software updates: use the dashboard's **Settings → Knowledge
template** panel or `context-use template plan` to preview missing directories and pages, safe
updates, and local conflicts, then apply the reviewed plan from the dashboard or with
`context-use template apply`.

Existing directories are never removed, local directory-presentation drift and locally edited
guides and managed pages are preserved, and create-only state pages are structurally checked but
never overwritten. A page explicitly listed in the template's `retired.json` is archived only
while it remains unpublished and template-owned; published or locally modified pages are
preserved for review. The dashboard can preview and confirm an eligible local-customization
replacement; from the CLI, add `--force-template` to both `context-use template plan` and
`context-use template apply` for the same behavior.

## Knowledge automations

Context Use stores automation instructions and supporting assets as ordinary private knowledge.
An external harness such as OpenClaw can schedule a job that reads a known instruction page with
`read_page` — for example, `automations/daily-fabric/instructions` — and then uses the ordinary
knowledge and asset tools. Scheduling, retries, and run history stay in the harness. An
incremental automation may keep exactly one non-secret opaque checkpoint on its stable `state`
page.

The default template installs managed instruction pages for activity distillation, diary
composition, and guideline consistency review, with checkpoint state where required. Apply
template updates with `context-use template apply`, then schedule an external harness to open and
execute the relevant instruction page. Those pages are the canonical operating contracts and are
deliberately not duplicated here.

The dashboard's **History** section shows the same durable page ledger, including creates,
updates, archives, and deletion tombstones without page bodies or diffs.
