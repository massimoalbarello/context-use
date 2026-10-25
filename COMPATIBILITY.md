# Compatibility policy

This policy supplements the [root engineering principles](./AGENTS.md).

- Database state is persistent. Preserve existing data and upgrade deployed schemas through new,
  forward migrations. Never edit, reorder, squash, rename, or delete applied migrations.
- API and other non-database contracts may still change incompatibly. Prefer the simplest coherent
  design; do not add compatibility layers solely to preserve those contracts.
