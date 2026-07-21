import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

export type PageDeletionPrincipal = {
  ownerUserId: string;
  sessionId: string;
};

export class PageDeletionRepository {
  constructor(private readonly pool: Pool) {}

  async createIntent(pageId: string, principal: PageDeletionPrincipal) {
    const id = randomUUID();
    const result = await this.pool.query(
      `INSERT INTO page_deletion_intents(
         id,page_id,expected_version_id,owner_user_id,session_id,expires_at
       )
       SELECT $1,page.id,page.current_version_id,$3,$4,now()+interval '5 minutes'
       FROM knowledge_pages page
       WHERE page.id=$2
         AND page.archived_at IS NOT NULL
         AND page.published_version_id IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM cron_schedules schedule
           WHERE schedule.instructions_page_id=page.id
         )
       RETURNING id,page_id,expected_version_id,expires_at`,
      [id, pageId, principal.ownerUserId, principal.sessionId],
    );
    return result.rows[0] ?? null;
  }
}
