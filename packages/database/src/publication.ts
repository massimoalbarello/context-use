import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { PublicationIntentInput } from "@context-use/shared";

function canonicalPayload(input: PublicationIntentInput): string {
  return JSON.stringify({
    action: input.action,
    target_kind: input.target_kind,
    target_id: input.target_id,
    version_id: input.version_id ?? null,
    public_slug: input.public_slug ?? null,
  });
}

export function hashPublicationPayload(input: PublicationIntentInput): string {
  return createHash("sha256").update(canonicalPayload(input)).digest("hex");
}

export class PublicationRepository {
  constructor(
    private readonly dashboardPool: Pool,
    private readonly publisherPool: Pool,
  ) {}

  async createIntent(
    input: PublicationIntentInput,
    principal: { ownerUserId: string; sessionId: string },
    challenge: string,
  ) {
    const id = randomUUID();
    const result = await this.dashboardPool.query(
      `INSERT INTO publication_intents(
        id,action,target_kind,target_id,version_id,public_slug,owner_user_id,
        session_id,challenge,payload_hash,expires_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now()+interval '5 minutes')
      RETURNING id,action,target_kind,target_id,version_id,public_slug,challenge,expires_at`,
      [id, input.action, input.target_kind, input.target_id, input.version_id ?? null,
        input.public_slug ?? null, principal.ownerUserId, principal.sessionId, challenge,
        hashPublicationPayload(input)],
    );
    return result.rows[0];
  }

  async getIntent(id: string) {
    const result = await this.dashboardPool.query(
      `SELECT id,action,target_kind,target_id,version_id,public_slug,owner_user_id,
        session_id,challenge,payload_hash,expires_at,consumed_at
       FROM publication_intents WHERE id=$1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async confirm(intentId: string, ownerUserId: string, sessionId: string, credentialId: string) {
    await this.publisherPool.query(
      "SELECT confirm_publication_intent($1,$2,$3,$4)",
      [intentId, ownerUserId, sessionId, credentialId],
    );
  }
}

export class PublicRepository {
  constructor(private readonly pool: Pool) {}

  async pageBySlug(slug: string) {
    const result = await this.pool.query("SELECT * FROM published_pages WHERE public_slug=$1", [slug]);
    return result.rows[0] ?? null;
  }

  async pageById(id: string) {
    const result = await this.pool.query("SELECT * FROM published_pages WHERE id=$1", [id]);
    return result.rows[0] ?? null;
  }

  async pageByPath(path: string) {
    const result = await this.pool.query(
      "SELECT * FROM published_pages WHERE path=$1 ORDER BY version_created_at DESC LIMIT 1",
      [path],
    );
    return result.rows[0] ?? null;
  }

  async asset(id: string) {
    const result = await this.pool.query("SELECT * FROM published_assets WHERE id=$1", [id]);
    return result.rows[0] ?? null;
  }
}
