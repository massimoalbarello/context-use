# Context-use memory for OpenClaw

This package is the thin OpenClaw binding for Context-use. It keeps the reusable boundary small:

- OpenClaw's bundled Active Memory hook performs read-only recall through Context-use MCP tools.
- This plugin claims OpenClaw's memory slot, disables local-memory flushes, and adds the durable-memory policy prompt.
- After a completed owner turn, it launches a curator through OpenClaw's own subagent runtime, explicitly reusing the parent turn's provider and model.
- Inbound assets receive opaque, turn-scoped handles. The curator can inspect them and stream their exact bytes only to a signed upload URL on the configured Context-use HTTPS origin.

The curator follows the live Context-use template by calling `context-use__prepare_change` before writes. Direct user statements do not receive synthetic Nango/source-record provenance.

## Install (linked and reversible)

```sh
openclaw plugins install --link /absolute/path/to/packages/openclaw-context-use
```

Back up `~/.openclaw/openclaw.json`, then dry-run and apply the included patch:

```sh
openclaw config patch --file ./openclaw.patch.json5 --dry-run
openclaw config patch --file ./openclaw.patch.json5
openclaw gateway restart
```

The patch adds only `context_use_attachment` to the active tool profile, selects `context-use-memory` in `plugins.slots.memory`, permits the plugin to read the completed turn and reuse its exact model, and configures `active-memory` with Context-use read tools. The attachment tool is session-bound and cannot read arbitrary paths or upload outside the HTTPS origin inferred from the `context-use` MCP server. Set `allowedUploadOrigins` only when that origin cannot be inferred. The patch deliberately does not pin a memory model: recall inherits the active OpenClaw session model, while capture passes the parent provider/model explicitly.

## Roll back

Stop the Gateway, uninstall the linked plugin with `openclaw plugins uninstall context-use-memory --force`, restore the backed-up `openclaw.json`, and start the Gateway again. The linked install does not copy or modify this package. Context-use records written during a test should be archived separately through its MCP tools.
