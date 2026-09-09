# Open-connector record sync

Context Use can receive complete, provider-neutral records from a trusted
[open-connector](https://github.com/massimoalbarello/open-connector) instance. Open-connector owns
provider credentials, acquisition, and delivery checkpoints. Context Use owns accepted records,
their external-service attribution, and downstream indexing. Provider credentials such as GitHub
or Granola credentials never belong in Context Use.

## Create and register an API key

The setup command creates one delivery API key for one named external service and configures that
open-connector instance to use it. Set these values in the command's server-side environment:

```sh
OPEN_CONNECTOR_INTEGRATION_ID=personal-open-connector
OPEN_CONNECTOR_OWNER_ID=context-use-owner
OPEN_CONNECTOR_BASE_URL=http://localhost:8787
OPEN_CONNECTOR_CALLBACK_URL=https://context-use.example/api/integrations/open-connector/records
# Supply OPEN_CONNECTOR_ADMIN_TOKEN through the command's secret environment.
```

`OPEN_CONNECTOR_INTEGRATION_ID` is a local Context Use external-service ID and display name. It
identifies the external service that presents the generated key; it is not sent to open-connector.
It must match `^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$`. The owner ID is an explicit trust mapping:
payload fields never select a Context Use owner or external-service identity.

The fixed `context-use-owner` owner must already have completed passkey registration. Then run:

```sh
bun run open-connector:setup -- register
```

Unless `OPEN_CONNECTOR_DELIVERY_API_KEY` is supplied through a server-side secret store, Context Use
generates a 32-byte API key in a private, per-integration file under `DATA_FOLDER`. Reusing the same
integration ID reuses that key; a different ID gets a different key. Only a SHA-256 fingerprint is
stored in the database, and a fingerprint can belong to only one external service. Neither secret
is printed or exposed to the browser.

The command first records the trusted local owner, service, and key, then sends the callback URL and
key to open-connector with its separate admin token:

```http
PUT /api/sync/destination
Authorization: Bearer <open-connector admin token>
Content-Type: application/json

{
  "url": "https://context-use.example/api/integrations/open-connector/records",
  "bearerToken": "<Context Use generated API key>",
  "enabled": true
}
```

The command checks that open-connector reports the same enabled destination. It is safe to rerun
for the same service. The admin token and delivery key must be distinct visible-ASCII values.
If a rotation reaches local storage but the remote update fails, open-connector's old-key attempts
receive `401` and remain unacknowledged; fix the connection and rerun `register` to resume them.

The receiver endpoint is always available at:

```text
https://<context-use-host>/api/integrations/open-connector/records
```

At delivery time Context Use hashes the presented Bearer key and resolves it to the trusted local
service and owner before reading the request body. An unknown key receives `401`; payload
`provider`, `sourceId`, and record content cannot change that attribution.

Open-connector currently has one destination per instance. One open-connector instance therefore
uses one Context Use service/key. Run setup with another local integration ID and another base URL
for each additional open-connector instance whose records should remain separately attributed.

## Populate records

Destination setup subscribes future acquired changes. To re-acquire existing GitHub pull requests,
start a backfill after registration:

```sh
bun run open-connector:setup -- backfill
```

The acquisition endpoint is synchronous and may run for ten minutes. Its output includes the run
ID, page and record counts, and whether the scan is complete. If it reports `complete:false`, or a
run was interrupted, continue its saved checkpoint without restarting the backfill:

```sh
bun run open-connector:setup -- continue
```

Repeat `continue` while successful output remains incomplete. With scheduling enabled,
open-connector may also continue unfinished work automatically. Use `backfill` only to intentionally
start or restart the scan. A `run_busy` response means another run owns acquisition; wait for it and
then use `continue`.

Unlike the former multi-receiver API, acquisition requests do not name a target receiver. The one
configured destination receives the instance's queued records. Authentication failures, missing
sync endpoints, malformed status responses, and busy runs are reported without logging either
secret.

## Record behavior

Open-connector POSTs v1 envelopes with Bearer authentication and `Idempotency-Key: <batchId>`.
Context Use validates the complete generic envelope and durably accepts the whole batch before
returning `200`. Each current record is namespaced by the authenticated external service plus the
opaque source, kind, and record IDs.

The Records section displays the delivered Markdown body as a read-only resource. Its title and
excerpt are tolerant projections of the Markdown, and it shows which external service's key
delivered it. Optional source URLs, timestamps, participants, and attributes are not used by the
Records UI yet. They remain protocol data rather than selecting ownership or triggering downloads.
Records are deliberately absent from Hypermedia.

Retries of the same batch or event are harmless. Only increasing revisions replace the current
body; tombstones remain durable so an older delivery cannot resurrect a deleted record. A delayed
indexing job is revision-fenced in the same way.

## Local and operational notes

- The callback must use public HTTPS. For local development, point a public HTTPS tunnel directly
  to the backend on port 3000. The tunnel or reverse proxy must accept at least 16 MiB and preserve
  `Authorization`, `Content-Type`, and `Idempotency-Key`; open-connector rejects redirects.
- The Context Use process needs no open-connector runtime secret or service environment. The
  webhook authenticates against the durable key fingerprints created by setup.
- Disabling or removing open-connector's singleton destination fences in-flight acknowledgements
  but retains queued records. Configuring an enabled destination again resumes delivery from the
  retained queue; no receiver ID or replacement-ID recovery exists in the current API.
- Keep both products' data folders durable. If the Context Use API-key file is lost, supply a new
  `OPEN_CONNECTOR_DELIVERY_API_KEY` and rerun `register`; open-connector will retry unacknowledged
  deliveries after the destination update.
- Authorized MCP clients can use `search_external_records` and `read_external_record` after the
  durable indexing worker processes a record. These tools do not add records to Hypermedia.
- To inspect protocol state, use `sqlite3 "$DATA_FOLDER/app.db" 'select integration_id, provider,
  kind, record_id, revision, operation from open_connector_record;'`. The normal product surface is
  the Records collection in the resource list.
