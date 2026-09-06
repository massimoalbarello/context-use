# Repository persistence invariants

The [root](../../../../AGENTS.md) and [backend](../../AGENTS.md) guides apply here.

## Query readability and execution

- Make a query's purpose, filtering stages, ordering, bounds, and completeness behavior apparent
  from its structure and names. Use named CTEs for meaningful relational stages, and keep
  repository orchestration separate from the SQL operations it coordinates when combining them
  would obscure either responsibility.
- Improve readability without accidentally changing execution characteristics. Do not introduce
  extra database round trips, unbounded intermediate results, duplicated work, weaker owner
  scoping, or weaker transaction semantics unless the measured benefit justifies the tradeoff.
