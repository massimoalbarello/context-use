# MCP transport invariants

The [root](../../../../../AGENTS.md), [backend](../../../AGENTS.md), and
[transport](../AGENTS.md) guides apply here. Asset-transfer guidance lives in the
[MCP asset guide](./assets/AGENTS.md).

- MCP tools are transport controllers over the same application services as HTTP. Keep entity,
  knowledge-page, and asset tools in their domain modules; do not introduce a generic resource
  model or reproduce service and repository rules in tool handlers.
- Use **OAuth client** for the protocol registration identified by `client_id`, **MCP client** for
  the external consumer visible to the user, and **MCP client authorization** for its owner-scoped
  durable approval and attribution identity.
- Keep the protocol transport stateless. Approval and credential lifecycle belong to an MCP client
  authorization, not a connection or transport session.
- Tool contracts should help a client recover from expected failure without exposing internal
  identifiers, persistence details, or another owner's resource existence.
