# Record delivery protocol

This document defines version 1 of the protocol used by an external sync to deliver records to
Context Use. The contract is provider-neutral: the bearer API key identifies the authorized sync
and the Context Use owner, so the request body must not contain a Context Use sync or owner ID.

This document is the complete implementer contract for the HTTP request, payload, hashing,
revision, and retry semantics.

## Authorization

An owner creates a sync in **Settings → Syncs** and receives two values once:

- the batch endpoint, ending in `/api/records/batch`;
- a UUIDv7 API key unique to that sync.

The key is a bearer credential and must be kept secret. Revoking the sync invalidates the key but
does not delete records already received from it.

## Request

Send one batch as UTF-8 JSON:

```http
POST /api/records/batch HTTP/1.1
Authorization: Bearer <UUIDv7 API key>
Content-Type: application/json
Idempotency-Key: <batchId>
```

`Content-Type` may include parameters such as `charset=utf-8`. `Idempotency-Key` is required and
must exactly equal the body `batchId`. `Content-Length` is optional; when present, it must be a
non-negative decimal integer.

The serialized request body must not exceed 16 MiB. A batch must contain between 1 and 50 records.

```json
{
  "version": 1,
  "batchId": "01991f43-0c00-7000-8000-000000000021",
  "records": [
    {
      "eventId": "01991f43-0c00-7000-8000-000000000022",
      "provider": "github",
      "sourceId": "github.com/example/project",
      "kind": "pull-request",
      "id": "42",
      "revision": 1,
      "operation": "added",
      "contentHash": "23cb71ca0f2454d85b1100e506f5fcd7dd9591872be6162023b92ee97ff94dc6",
      "committedAt": "2026-09-10T12:00:00.000Z",
      "content": {
        "body": "# Hello"
      }
    }
  ]
}
```

Objects are strict: unknown fields in the envelope, a record, record content, a participant, or a
participant identity are rejected.

### Envelope

| Field | Requirement |
| --- | --- |
| `version` | Must be the number `1`. |
| `batchId` | Opaque string, 1–1024 characters, containing at least one non-whitespace character. |
| `records` | Between 1 and 50 record changes. |

Every `eventId` must be unique within the batch. A batch must also contain each record identity at
most once. Within one authorized sync, record identity is the tuple `(sourceId, kind, id)`.

### Record change

| Field | Requirement |
| --- | --- |
| `eventId` | Opaque string, 1–1024 characters, unique within the batch. |
| `provider` | Opaque provider identifier, 1–1024 characters. |
| `sourceId` | Opaque source or installation identifier, 1–1024 characters. |
| `kind` | Opaque record-kind identifier, 1–1024 characters. |
| `id` | Opaque provider-native record identifier, 1–1024 characters. Do not coerce numeric IDs to JSON numbers. |
| `revision` | Positive safe integer, at most `9007199254740991`, increasing for this record identity. |
| `operation` | `added`, `updated`, or `deleted`. |
| `contentHash` | Lowercase hexadecimal SHA-256 digest. For additions and updates it must hash the canonical `content`. |
| `committedAt` | Timezone-qualified RFC 3339 timestamp. |
| `content` | Required for `added` and `updated`; omitted for `deleted`. |

`provider`, `sourceId`, `kind`, `id`, and `eventId` must each contain a non-whitespace character.
Their values are opaque and are preserved without trimming.

### Record content

`content.body` is required, must contain a non-whitespace character, and is interpreted as
Markdown. Context Use currently stores this Markdown; the optional content fields below are
accepted as part of the versioned delivery contract but are not otherwise used.

The canonical serialized `content` must not exceed 8 MiB. Content may also include:

- `sourceUrl`: an HTTP or HTTPS URL without embedded credentials;
- `sourceCreatedAt` and `sourceUpdatedAt`: timezone-qualified RFC 3339 timestamps;
- `participants`: at most 1,000 participants, each with 1–16 `{ namespace, id }` identities,
  1–32 roles, and an optional name; every string must contain a non-whitespace character;
- `attributes`: a JSON object whose serialized size does not exceed 16 KiB.

## Content hashing

For an `added` or `updated` record, `contentHash` is the lowercase SHA-256 digest of the UTF-8 bytes
of canonical JSON for the exact `content` sent in the request:

1. Sort object keys lexicographically at every nesting level.
2. Preserve array order.
3. Serialize without insignificant whitespace using standard JSON scalar representations; `-0`
   serializes as `0` and all numbers must be finite.
4. Omit absent optional fields.

The example content canonicalizes to `{"body":"# Hello"}` and hashes to
`23cb71ca0f2454d85b1100e506f5fcd7dd9591872be6162023b92ee97ff94dc6`.

## Acceptance and revisions

Context Use authenticates the bearer key, validates the complete envelope, and applies the batch in
one database transaction. It returns `200` only after every applicable record change is durably
stored. If validation, conflict detection, or storage fails, no change from that batch is committed.

For each record identity:

- a higher revision replaces the current record;
- an older revision is an acknowledged no-op;
- the same revision with the same delivered state is an acknowledged no-op;
- the same revision with different delivered state returns `409` and rolls back the batch;
- a higher `deleted` revision stores a tombstone and removes the record from active listings,
  preventing an older revision from resurrecting it.

The authenticated API key, not a sender-supplied field, determines which sync delivered every
record.

## Responses and retries

| Status | Meaning | Sender action |
| --- | --- | --- |
| `200` | The complete batch is durably accepted or is already represented by equal/newer revisions. | Acknowledge the batch. |
| `400` | Malformed JSON, an invalid field or hash, duplicate identity, or mismatched idempotency key. | Correct the batch before retrying. |
| `401` | Missing, malformed, unknown, or revoked bearer API key. | Correct or replace the destination credential. |
| `409` | A stored record has the same revision but different delivered state. | Resolve the sender's revision history before retrying. |
| `413` | The request exceeds 16 MiB. | Split or reduce the batch. |
| `415` | The media type is not `application/json`. | Correct the request headers. |
| `500` | The batch was not durably accepted. | Retry with backoff. |

A retry must preserve the exact serialized body, `batchId`, and matching `Idempotency-Key`. Context
Use does not persist batch envelopes; revision semantics make a successfully stored retry harmless.
Senders must retain an unacknowledged batch until it receives `200`.
