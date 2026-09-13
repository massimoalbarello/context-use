# UI primitive invariants

The [root](../../../../../AGENTS.md) and [frontend](../../../AGENTS.md) guides apply here.

- This directory contains reusable shadcn/ui primitives built on Base UI. It contains no product,
  resource, route, data-fetching, or application-workflow logic.
- Use Base UI consistently for interactive foundations. Do not mix primitive libraries or build a
  parallel version of an existing interaction without an explicit architectural reason.
- Preserve the upstream primitive's accessibility and interaction semantics. Application wrappers
  are justified only when they establish a real shared behavior or visual contract.
- A primitive owns all generally applicable focus, keyboard, disabled, loading, and error behavior.
  Product-specific composition stays with the feature that gives it meaning.
