# Nango sync record guidelines

These rules apply to every record saved by a Nango sync in this repository. The downstream
pipeline processes these records, so their shape and content are an application contract.

## Markdown is the canonical content

Every discoverable record must have a non-empty root `body` containing semantic Markdown. It must
stand on its own without requiring the pipeline to interpret provider-specific JSON.

Include every fact that matters for retrieval or understanding:

- a descriptive heading with source context;
- status, source URL, and important timestamps;
- authors and other participants using stable, human-readable identifiers;
- the complete user-authored content;
- relevant nested activity such as messages, replies, commits, reviews, comments, reactions,
  attachments, and links;
- locations such as repository paths and line numbers when they give an event meaning; and
- an explicit warning when a provider has capped or omitted expected content.

Use headings and chronological sections so the body reads like a concise source document. Preserve
user-authored Markdown. Do not produce a JSON dump inside a Markdown fence.

Important information must not exist only in a nested structured field. If the pipeline needs to
know it, render it in `body`.

## Keep the JSON contract universal

Every discoverable record must use `PipelineRecordSchema` and contain exactly:

- `id` for stable Nango identity and updates;
- `created_at` and `updated_at` as ISO 8601 strings;
- `participants` as compact, unique identifiers; and
- `body` as the canonical Markdown document.

Do not add connection-specific root fields such as repository, channel, message, document, commit,
pull-request, or provider IDs. Put source context, provider completeness warnings, and other useful
details in `body`. The root `id` is the necessary exception because Nango requires stable identity.

Internal state or checkpoint models that are not sent to the downstream pipeline may use a
sync-specific schema.

Register every discoverable model in the managed function's `pipelineModels` array in
`catalog.ts`. Keep internal sync-state models only in `models`; catalog membership is the explicit
boundary that lets the downstream MCP request pipeline data without trying to infer model purpose.

Never save:

- whole provider responses or a `raw`/`payload` copy;
- redundant nested provider IDs, node IDs, object types, permissions, or privacy flags;
- API navigation URLs, pagination cursors, ETags, debug data, or duplicated timestamps;
- nested user, repository, branch, or commit objects when a compact identifier or Markdown line is
  sufficient; or
- large patches and blobs unless the integration's documented purpose requires their content.

Provider response schemas may accept extra keys while fetching. Discoverable records must be parsed
through the shared `PipelineRecordSchema` and constructed from normalized values.

## Hydrate deliberately

Fetch related endpoints when they add user-visible context needed by the pipeline. Paginate until
the provider is exhausted, save progress incrementally, and expose any documented provider cap.
Do not hydrate related data simply to archive it.

## Tests are part of the contract

Every sync test must:

1. parse the saved record through its exported model schema;
2. assert the exact root contract or otherwise prove it remains compact;
3. assert that `body` contains every important class of source content and context;
4. put realistic provider-only sentinel fields in fixtures and assert they are absent from the
   saved JSON; and
5. cover pagination, incomplete related collections, and incremental state when applicable.

When a saved model changes incompatibly, bump the sync version and document that existing records
must be reset and resynchronized after deployment.
