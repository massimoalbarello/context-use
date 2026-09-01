# Transport invariants

The [root](../../../../AGENTS.md) and [backend](../../AGENTS.md) guides apply here. MCP transport
guidance lives in the [MCP guide](./mcp/AGENTS.md).

- Organize routes by transport path. A route subtree owns its request and response schemas,
  authentication boundary, controller, and transport-specific mapping.
- Validate every untrusted path, query, header, and body value at the boundary. Keep runtime
  validation and the published contract derived from the same schema.
- Controllers map authentication, validation, domain failures, and responses; they do not contain
  SQL or coordinate business workflows. HTTP and MCP controllers delegate to the same application
  services rather than copying domain rules.
- Expose public resources through immutable readable identifiers and typed `context-use://`
  addresses. Database UUIDs and storage keys remain internal; map public responses explicitly
  instead of spreading persistence models into transport contracts.
- Apply authorization and capability checks at the boundary that owns them, then preserve the actor
  and owner through the service and repository call.
