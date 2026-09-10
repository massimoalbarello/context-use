# Receiving synced records

Context Use implements version 1.0.0 of OpenConnector’s
[record delivery contract](https://github.com/massimoalbarello/open-connector/blob/b16b86d84a1a3c8777f07ddb6edeadef878b82ae/docs/record-delivery.openapi.yaml).
The pinned OpenAPI document generates Context Use’s payload types, route validator, and delivery
limits; payload and transport changes belong in that upstream contract first.

Context Use owns only its receiver configuration:

- create an authorized sync in **Settings → Syncs**;
- copy the displayed `POST /api/records/batch` endpoint and one-time UUIDv7 API key into the sender’s
  destination settings;
- the sender presents that key as the contract’s opaque bearer token;
- the authenticated key determines the Context Use owner and sync recorded as provenance.

Context Use validates the complete delivery and stores its individual record changes in one
database transaction. It returns `200` only after the transaction commits. Batch envelopes are not
stored; retries are resolved by record identity and revision, including multiple revisions of one
record in the same batch.
