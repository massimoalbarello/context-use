# Database invariants

The [root](../../../../AGENTS.md) and [backend](../../AGENTS.md) guides apply here.

Database state is a durable shared asset. Before changing it, define the invariant, expected prior
state, failure behavior, verification method, and recovery path. Fail closed when existing state is
unexpected or ambiguous, and do not add speculative schema or migration machinery.

## Schema migrations

- A schema migration changes schema only. Keep backfills, repairs, normalization, seeds, and other
  application-data changes out of the migration runner.
- Give each migration one schema concern. Keep it deterministic and transactional where the engine
  permits, and never make it depend on an external service or the current contents of application
  tables.
- Once a migration has been applied to a persistent shared environment, its identity and contents
  are immutable. Disposable local databases do not establish compatibility history.
- Keep migration history and engine-specific constraints with the adapter that owns them. Do not
  force adapters into a shared lowest-common-denominator schema or dialect conditionals.

## Application-data changes

Run a data change as an explicit application operation, separate from application startup and
schema migration. A data job must be safe to retry, resumable after interruption, bounded in
memory, observable, and able to verify the invariant it establishes. Destructive changes also need
a recovery path whose target and scope have been proven.

## Portability and proof

- Keep database clients, SQL, transactions, migration discovery, and adapter error translation
  behind repository and database boundaries. Add a second engine as a concrete adapter before
  generalizing shared infrastructure.
- Use the real engine when proving constraints, transactions, locking, or query semantics. Give
  each schema invariant one authoritative integration test rather than repeating repository happy
  paths at the migration layer.
