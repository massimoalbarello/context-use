import type { Pool } from "pg";

export type ConfirmationIntentKind = "publication" | "knowledge_export";

export type ConfirmationPasskey = {
  id: string;
  name: string | null;
  publicKey: string;
  userId: string;
  credentialID: string;
  counter: number;
  transports: string | null;
  createdAt: Date | null;
};

export type VerifiedPasskey = {
  credentialId: string;
  expectedCounter: number;
  newCounter: number;
};

export class ConfirmationRepository {
  constructor(private readonly pool: Pool) {}

  async issueChallenge(kind: ConfirmationIntentKind, intentId: string, challenge: string): Promise<void> {
    await this.pool.query(
      "SELECT issue_confirmation_challenge($1,$2,$3)",
      [kind, intentId, challenge],
    );
  }

  async passkeys(ownerUserId: string): Promise<ConfirmationPasskey[]> {
    const result = await this.pool.query<ConfirmationPasskey>(
      `SELECT id,name,"publicKey","userId","credentialID",counter,transports,"createdAt"
       FROM passkey WHERE "userId"=$1 ORDER BY "createdAt"`,
      [ownerUserId],
    );
    return result.rows;
  }

  async publicationIntent(id: string) {
    const result = await this.pool.query(
      `SELECT id,action,target_kind,target_id,version_id,public_path,owner_user_id,
        session_id,challenge,payload_hash,expires_at,consumed_at
       FROM publication_intents WHERE id=$1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async exportIntent(id: string) {
    const result = await this.pool.query(
      `SELECT id,owner_user_id,session_id,challenge,expires_at,confirmed_at,
        credential_id,download_started_at
       FROM knowledge_export_intents WHERE id=$1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async confirmPublication(
    intentId: string,
    principal: { ownerUserId: string; sessionId: string },
    passkey: VerifiedPasskey,
  ): Promise<void> {
    await this.pool.query(
      "SELECT confirm_publication_intent($1,$2,$3,$4,$5,$6)",
      [intentId, principal.ownerUserId, principal.sessionId, passkey.credentialId,
        passkey.expectedCounter, passkey.newCounter],
    );
  }

  async confirmExport(
    intentId: string,
    principal: { ownerUserId: string; sessionId: string },
    passkey: VerifiedPasskey,
  ): Promise<void> {
    await this.pool.query(
      "SELECT confirm_knowledge_export_intent($1,$2,$3,$4,$5,$6)",
      [intentId, principal.ownerUserId, principal.sessionId, passkey.credentialId,
        passkey.expectedCounter, passkey.newCounter],
    );
  }

  async claimExport(intentId: string, principal: { ownerUserId: string; sessionId: string }): Promise<void> {
    await this.pool.query(
      "SELECT claim_knowledge_export_download($1,$2,$3)",
      [intentId, principal.ownerUserId, principal.sessionId],
    );
  }
}
