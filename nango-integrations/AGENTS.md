# Nango integration instructions

Read [`SYNC_GUIDELINES.md`](./SYNC_GUIDELINES.md) before creating or changing a sync.

The objects passed to `nango.batchSave()` are pipeline contracts, not provider archives. Every
discoverable record must contain a complete, readable Markdown `body`, and the surrounding JSON
must use the provider-agnostic `PipelineRecordSchema` from `pipeline-record.ts`. Never add
connection-specific root fields, save an unfiltered provider response, or use a loose schema for a
saved record. List every discoverable model, and only those models, in its managed function's
`pipelineModels` catalog entry so the private MCP can read it. Internal sync-state models are exempt
because the downstream pipeline does not consume them and must never appear in `pipelineModels`.
