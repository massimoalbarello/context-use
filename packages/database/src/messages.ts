import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

export type InboundMessage = {
  id: string;
  reply_to: string;
  message: string;
  created_at: Date;
};

export class PublicMessageRepository {
  constructor(private readonly pool: Pool) {}

  async create(replyTo: string, message: string): Promise<{ id: string }> {
    const id = randomUUID();
    await this.pool.query(
      "INSERT INTO inbound_messages(id,reply_to,message) VALUES ($1,$2,$3)",
      [id, replyTo, message],
    );
    return { id };
  }
}

export class InboxRepository {
  constructor(private readonly pool: Pool) {}

  async listForOwner(ownerUserId: string): Promise<InboundMessage[]> {
    const result = await this.pool.query<InboundMessage>(
      `SELECT id,reply_to,message,created_at
       FROM inbound_messages
       WHERE owner_user_id=$1
       ORDER BY created_at DESC,id DESC`,
      [ownerUserId],
    );
    return result.rows;
  }
}
