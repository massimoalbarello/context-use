import type { PoolClient } from "pg";

export const PAGE_VERSION_RETENTION_LIMIT = 5;

export async function prunePageVersions(client: PoolClient, pageId: string): Promise<number> {
  const result = await client.query<{ removed: number }>(
    "SELECT prune_page_versions($1) AS removed",
    [pageId],
  );
  return result.rows[0]?.removed ?? 0;
}
