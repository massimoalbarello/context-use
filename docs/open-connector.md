# Open-connector record sync

Context Use can receive complete, provider-neutral records from a trusted
[open-connector](https://github.com/massimoalbarello/open-connector) instance. Open-connector owns
provider credentials and acquisition checkpoints; Context Use owns accepted records and downstream
ingestion. GitHub credentials never belong in Context Use.

## Configure the receiver

Set both runtime values on the Context Use server:

```sh
OPEN_CONNECTOR_RECEIVER_ID=context-use
OPEN_CONNECTOR_OWNER_ID=context-use-owner
```

The receiver ID is also the local integration namespace. It must match
`^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$`. The owner ID is an explicit trust mapping: source IDs and
record content from open-connector never select a Context Use owner. `context-use-owner` is the
fixed owner ID created when this single-owner instance is claimed.

By default Context Use creates a 32-byte receiver Bearer token once at
`DATA_FOLDER/.open-connector-receiver-token`, with private file permissions, and reuses it across
restarts. Keep `DATA_FOLDER` durable. `OPEN_CONNECTOR_RECEIVER_TOKEN` may instead supply that token
through a server-side secret store. Tokens must contain only visible ASCII so they are safe HTTP
header values. Never expose one to the browser.

Context Use stores only the token's SHA-256 fingerprint with the receiver-to-owner binding. A new
binding records its first configured token. After that, a missing token file or a different secret
never activates a replacement implicitly: startup fails on every attempt until you restore the
registered token or explicitly run `register`. Registration records a changed fingerprint only
after open-connector confirms the receiver update. The database migration creates this marker with
the receiver tables; a pre-release binding that somehow has no marker must also be registered
explicitly rather than being guessed from a newly generated file.

The callback must be public HTTPS and point exactly to:

```text
https://<context-use-host>/api/integrations/open-connector/records
```

For local development, create a public HTTPS tunnel directly to the backend on port 3000 and use
the tunnel URL as the callback. Configure the tunnel or reverse proxy to accept at least 16 MiB
request bodies and to pass the `Authorization`, `Content-Type`, and `Idempotency-Key` headers.
Redirecting callbacks are rejected by open-connector.

## Register and populate

Run setup on the same host and with the same `DATA_FOLDER` as the receiver so it resolves the same
generated token. Add these setup-only values to that server-side command environment:

```sh
OPEN_CONNECTOR_BASE_URL=http://localhost:8787
OPEN_CONNECTOR_CALLBACK_URL=https://context-use.example/api/integrations/open-connector/records
# Supply OPEN_CONNECTOR_ADMIN_TOKEN through the command's secret environment.
```

The admin token and receiver token must be distinct, visible-ASCII Bearer tokens. The admin token is
sent only to open-connector and is not part of the receiver's runtime configuration.

The fixed `context-use-owner` owner must already have completed passkey registration. Every setup
operation first migrates the local database and persists the receiver-to-owner binding. An unknown
owner or an attempt to move an existing receiver ID to a different owner aborts before any request
is sent to open-connector.

From the repository root, register or update the stable receiver:

```sh
bun run open-connector:setup -- register
```

Registration subscribes only to future changes. If records already exist, start one targeted
GitHub pull-request backfill after registration:

```sh
bun run open-connector:setup -- backfill
```

The acquisition endpoint is synchronous and may run for ten minutes. Its output includes the run
ID, page and record counts, and whether the targeted scan is complete. A successful run may still
stop at its page or time bound with `complete:false`. If that happens, or if a run is interrupted,
resume the same checkpoint without resetting the scan:

```sh
bun run open-connector:setup -- continue
```

Repeat `continue` while successful output reports that the scan is incomplete. With scheduling
enabled, open-connector retains the receiver target and may continue unfinished work automatically.
Use `backfill` only to intentionally start or restart the scan. A `run_busy` response means another
run owns it; wait for that run and then use `continue`. Authentication failures, missing sync
endpoints, malformed success responses, changed credentials, and receiver-binding conflicts are
reported as setup errors without printing either secret.

## Operational notes

- Receiver registration is instance-wide: every enabled receiver gets future changes from every
  synced source. Use only a trusted open-connector instance with the explicit owner mapping above.
- Disabling a receiver is not a lossless pause. Re-enabling it does not fill the resulting gap.
- When receiver configuration is absent, Context Use recovers any already accepted ingestion jobs
  (including delayed retries and expired leases), then stops the recovery worker once none remain.
- Re-registering the same ID preserves prior acknowledgements. If Context Use storage is lost,
  restore it or choose a new receiver ID and perform a targeted backfill; the old ID cannot replay
  already acknowledged payloads.
- If the database survives but the receiver token is lost, restore the original token when
  possible. Otherwise set the intended replacement and run `register`; rerunning registration is
  safe if open-connector accepted the update but Context Use stopped before recording its local
  fingerprint. Restart any already-running Context Use process with that replacement token after
  registration; receiver credentials are loaded at startup rather than hot-reloaded.
- Authorized MCP clients can use `search_external_records` and `read_external_record` after the
  durable ingestion worker indexes a record. These read-only tools keep external records separate
  from curated knowledge pages and preserve their provider provenance.
- To exercise the real delivery boundary, register the HTTPS tunnel callback, run `backfill`, and
  inspect durable current records with `sqlite3 "$DATA_FOLDER/app.db" 'select integration_id,
  provider, kind, record_id, revision, operation from open_connector_record;'`. Re-run `continue`
  to check that persisted checkpoints and duplicate deliveries are harmless.
