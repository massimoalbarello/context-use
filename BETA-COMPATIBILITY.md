# Beta compatibility policy

This policy supplements the [root engineering principles](./AGENTS.md).

Context Use is beta software and no instance has been deployed. Backward compatibility is not a
requirement.

- Prefer the simplest coherent design even when it requires a breaking change.
- Existing migrations may be edited, reordered, squashed, renamed, or deleted.
- Local development databases are disposable and must be recreated after an incompatible schema
  change.
- Do not add compatibility migrations or legacy application paths solely to preserve disposable
  local state.
