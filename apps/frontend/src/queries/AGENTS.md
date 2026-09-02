# Query invariants

The [root](../../../../AGENTS.md) and [frontend](../../AGENTS.md) guides apply here.

- Query modules own API calls, query keys, and query options. Components do not call the raw API
  client or maintain a parallel cache.
- Define a query-key family once and include every value that changes the result. Reads, mutations,
  and invalidation share those keys.
- Treat authenticated query data as session-scoped. Clear it across authentication transitions or
  include the actor in its key so private data cannot cross principals.
