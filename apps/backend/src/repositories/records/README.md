# Record persistence

`RecordsRepository` owns publication and reads. Its domain-facing `contract.ts` accepts delivered
records and returns typed record resources without exposing SQL, file paths, or storage clients.
`RecordCatalog` owns SQLite queries; `RecordFiles` owns storage serialization and verification. The
composition root supplies the same local storage client used by pages and assets, and a dedicated
SQLite connection to the same database file. Catalog operations sharing that connection are
serialized: Bun SQLite otherwise allows unrelated queries to observe an in-flight transaction.
Other capabilities use the primary connection and cannot join or observe a record transaction.

## Canonical storage and reads

Files are immutable JSON snapshots under the application's existing `objects` directory:

```text
<encoded ownerId>/records/<encoded syncId>/<identity SHA-256>/<UUIDv7>.json
```

The identity digest is SHA-256 of `JSON.stringify([sourceId, kind, id])`. The snapshot is
`{ version: 1, ownerId, syncId, readableId, receivedAt, record }`, where `record` is the complete
accepted `DeliveredRecord`. This retains the original Markdown string, provider, source identity,
kind, record ID, event ID, revision, operation, source content hash, committed timestamp, source URL
and timestamps, participants, and attributes. Deletions store the contract's content-free tombstone.
The file schema reuses the runtime record schema generated from the pinned delivery contract.

`record_sync` still owns authorization and sync names. `record_delivery_head` contains only the
owner/sync and identity digest, immutable readable ID, current revision and operation, a revision
fingerprint, a file reference with its SHA-256 and byte length, and local creation/update timestamps.
It is the publication catalog and revision high-water mark; it cannot reconstruct record content.

`listResources({ ownerId, limit, offset })` selects a bounded page of active heads, then derives
summaries from verified files. `findResource({ ownerId, readableId })` returns the existing summary
and `markdown`, plus `record: Exclude<DeliveredRecord, { operation: 'deleted' }>` for internal
consumers such as a derived search index. The public HTTP response maps its existing fields
explicitly. Readable ID generation and `/api/records/:readableId` and `/records/:readableId`
addresses are unchanged. Tombstones and another owner's IDs produce not-found results. Revoking a
sync blocks delivery but retains its previously accepted resources.

Reads verify byte length, SHA-256, schema, owner/sync, record identity, readable ID, revision,
operation, and revision fingerprint. Missing or corrupt files fail; SQL is never a content fallback.
The supplied source `contentHash` is preserved separately from the receiver's file checksum.

## Publication and failure behavior

Each attempt allocates fresh keys, writes all candidate files, and reads them back for verification.
It then opens a SQLite `BEGIN IMMEDIATE` transaction, rechecks the owner-bound active sync, and
publishes the whole batch. No storage I/O runs inside that transaction. The write lock protects
revision decisions across repository instances and database connections.

Higher revisions replace the head while preserving its readable ID and creation time. Older
revisions are ignored, including those arriving after a tombstone. Equal revisions must have the
same canonical JSON fingerprint of all delivered fields except `eventId`; a conflict rolls back the
whole batch. JSON object property order does not change the fingerprint. The original accepted
event remains in the file on retry. A higher revision can restore a deleted record at the same ID.

Before publication, any write/verification error, SQL rollback, conflict, or revoked sync causes
cleanup of this attempt's unpublished files, including partial writes. After publication, unused
candidates are removed. Published files are never removed by delivery cleanup. This permits a reader
holding an older head to finish while another delivery commits. Superseded committed files remain
on disk; deletion is a visibility tombstone, not secure erasure.

A rejected cleanup is surfaced as an error, retaining both errors when acceptance also failed.
If cleanup fails after commit, the whole batch is already published and retry remains idempotent.
Likewise, a lost response after commit can be retried without changing the accepted revision.

As with the existing page/asset write-before-publish pattern, a process exit before commit can leave
unreferenced files. They are invisible to readers. This adapter does not scan files to infer commits
or automatically garbage-collect them. An unreferenced file can also be a retained committed
revision, so absence from the current-head catalog alone is not a safe deletion policy. There is no
cross-store power-loss transaction beyond the guarantees of the existing storage client and SQLite.
Backups/recovery must preserve the catalog together with its referenced files. Restore a missing or
corrupt file from a verified backup; do not synthesize content from SQL. A deliberate newer source
revision can replace a damaged current revision through normal delivery.

The beta schema is edited in migration 0008 in place. There is no compatibility migration, backfill,
dual read, or automatic reset of an existing database. An old local database requires a separately
chosen recreation before using this schema.
