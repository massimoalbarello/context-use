# Database migration guide

The root and backend guides apply here. This file adds SQLite-specific rules for the client, schema
migration runner, and ordered schema history. Application data access belongs in repositories;
business workflows belong in services.

## Principles

Database state is a durable shared asset and must be changed with exceptional care. A database
change is not an implementation convenience; it is a compatibility and operational commitment.

- Define the invariant being introduced or preserved, the expected prior state, failure behavior,
  rollout order, verification method, and recovery path before applying the change.
- Prefer the simplest safe change. Favor additive and reversible evolution; require explicit proof
  before removing or irreversibly transforming state.
- Fail closed when the current state is unexpected or ambiguous. Never coerce unknown state into the
  expected shape merely to let a deployment continue.
- Do not add speculative tables, columns, indexes, or migration machinery without a concrete current
  requirement.
- A destructive data operation requires an explicit recovery plan and proof that its target and
  scope are correct.

## Schema migrations

A schema migration changes schema. It never migrates application data.

- Add the next numbered file in `migrations/`. Once a migration has been applied in any shared
  environment, never edit, squash, reorder, rename, or reuse its number.
- Give each migration one reviewable reason to exist. Creating a table may include that table's
  directly owned constraints and indexes; unrelated tables and schema changes use separate files.
- Do not generate or commit a full schema dump as a migration. Build schema history through small,
  intentional changes whose filenames describe their purpose.
- Do not put `INSERT`, `UPDATE`, `DELETE`, data-copying statements, seeds, backfills, repairs, or
  normalization work in a schema migration.
- Migrations are deterministic and transactional where SQLite permits. They do not call external
  services or silently tolerate an unknown prior schema.
- The migration runner may apply pending schema migrations during application startup. It must never
  run application data jobs there.

## Data changes and rollout

Use expand, migrate, cut over, and contract as distinct stages:

1. Add backward-compatible schema in a focused migration.
2. Deploy application code that can operate safely during the transition.
3. Run an explicit application operation or dedicated data-migration script after the schema change.
4. Verify a named invariant and record enough progress to resume safely.
5. Switch canonical reads and writes in a separate application change.
6. Remove obsolete schema in a later migration only after the retired path is unused.

A dedicated data job must be idempotent, resumable, bounded in memory, safe to retry, and
observable. Process large datasets in stable batches, expose progress and failures, and provide
verification or dry-run behavior when practical. Run it only through an explicit operator command.

## Red flags

- A migration changes more than one unrelated schema concern.
- A migration's correctness depends on the current contents of application tables.
- A migration creates schema and rewrites existing rows in the same rollout step.
- A data job runs automatically from the migration runner or application startup.
- A shipped migration is edited to make a fresh installation pass.
- Repository or business logic is added to the migration runner.
- A destructive or irreversible change has no verification and recovery plan.

## Tests

- Enforce the schema-only policy automatically for every migration.
- Test both a fresh database and upgrades from each supported prior schema version.
- Use the real SQLite engine for constraints, transactions, locking, and query behavior that a fake
  cannot prove.
- Give each schema invariant one authoritative integration test; do not repeat every repository
  happy path at the migration layer.
- Share database lifecycle, fixtures, cleanup, and invariant assertions through one test harness.
