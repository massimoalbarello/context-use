# MCP asset-transfer invariants

The [root](../../../../../../AGENTS.md), [backend](../../../../AGENTS.md),
[transport](../../AGENTS.md), and [MCP](../AGENTS.md) guides apply here.

- Transfer capabilities are short-lived and single-use. Capability secrets belong in required
  headers, never URLs or persisted pending-upload records, so logs and durable state do not retain
  bearer credentials.
