import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { PublicationIntentInput } from "@context-use/shared";

export class PublicationRepository {
  constructor(private readonly dashboardPool: Pool) {}

  async createIntent(
    input: PublicationIntentInput,
    principal: { ownerUserId: string; sessionId: string },
    publicPath: string | null,
  ) {
    const id = randomUUID();
    const result = await this.dashboardPool.query(
      `INSERT INTO publication_intents(
        id,action,target_kind,target_id,version_id,public_path,owner_user_id,
        session_id,expires_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now()+interval '5 minutes')
      RETURNING id,action,target_kind,target_id,version_id,public_path,expires_at`,
      [id, input.action, input.target_kind, input.target_id, input.version_id ?? null,
        publicPath, principal.ownerUserId, principal.sessionId],
    );
    return result.rows[0];
  }

}

export class PublicRepository {
  constructor(private readonly pool: Pool) {}

  async pageByPublicPath(path: string) {
    const result = await this.pool.query(
      "SELECT public_path,title,body_markdown FROM published_pages WHERE public_path=$1",
      [path],
    );
    return result.rows[0] ?? null;
  }

  async assetByPublicPath(path: string) {
    const result = await this.pool.query(
      "SELECT public_path,filename,content_type,size_bytes FROM published_assets WHERE public_path=$1",
      [path],
    );
    return result.rows[0] ?? null;
  }
}

export class StoragePublicationRepository {
  constructor(private readonly pool: Pool) {}

  async assetByPublicPath(path: string) {
    const result = await this.pool.query(
      "SELECT public_path,s3_object_key FROM storage_published_assets WHERE public_path=$1",
      [path],
    );
    return result.rows[0] ?? null;
  }
}
