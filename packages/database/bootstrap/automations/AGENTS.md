# Automation instructions

The `automations/` directory stores instructions and supporting assets for automations that run in an external harness. Context Use provides private, versioned knowledge and assets; it does not schedule jobs, execute them, retry them, or store run state.

## Structure

- Give each automation a stable kebab-case directory at `automations/<automation-name>/`.
- Store its canonical instruction page at `automations/<automation-name>/instructions`.
- Reserve the `instructions` leaf within each automation directory for that canonical instruction page; do not use it for unrelated pages or assets.
- Use the automation directory only for automation definitions and the supporting context or assets they need, such as an HTML template.
- Store durable output at the canonical path for its subject, not beneath `automations/`, unless the instructions explicitly require an automation-local artifact.
- Link instruction pages, supporting pages, and assets with ordinary Context Use references.

Automation instruction and support pages use the ordinary page lifecycle and tools. They are private by default. Reading or editing them never requires publication, and an external harness should access them through the authenticated MCP connection.

Keep schedules, retries, run history, execution state, and credentials in the external harness. Never store secrets in automation instruction pages or assets.
