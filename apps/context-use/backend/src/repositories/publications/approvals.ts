import { type TypedSQL, type TypedTransactionSQL, withTypes } from '@ilbertt/bun-sqlgen';
import type { SQL } from 'bun';
import type { Queries } from '#backend/queries.gen.ts';
import type { PublicationRequest, PublicationTransitionResult } from './repository.ts';
import { executePublication } from './transitions.ts';

const APPROVAL_LIFETIME_MS = 300_000;
const AUTHORIZATION_LIFETIME_MS = 120_000;

export interface PublicationApproval {
  id: string;
  challenge: string;
  request: PublicationRequest;
  expectedState: string;
  expiresAt: string;
}

export interface PublicationCredential {
  id: string;
  credentialId: string;
  publicKey: string;
  counter: number;
  transports: string | null;
}

type AuthorizationIdentity = { ownerId: string; sessionId: string; now: string };
type ApprovalIdentity = AuthorizationIdentity & { approvalId: string };

export type PublicationApprovalResult =
  | PublicationTransitionResult
  | { state: 'approval_invalid' | 'credential_changed' };

export interface PublicationApprovalsRepositoryContract {
  authorizationExpiresAt(input: AuthorizationIdentity): Promise<string | null>;
  completeAuthorizedApproval(
    input: ApprovalIdentity,
  ): Promise<PublicationApprovalResult | { state: 'assertion_invalid' }>;

  create(input: {
    request: PublicationRequest;
    sessionId: string;
    challenge: string;
    expectedState: string;
    now: string;
  }): Promise<PublicationApproval | null>;
  find(input: ApprovalIdentity): Promise<PublicationApproval | null>;
  credentials(input: { ownerId: string }): Promise<PublicationCredential[]>;
  completeVerifiedApproval(
    input: ApprovalIdentity & { credential: PublicationCredential; newCounter: number },
  ): Promise<PublicationApprovalResult>;
}

async function findApproval({ db, ...input }: ApprovalIdentity & { db: TypedSQL<Queries> }) {
  const rows = await db.FindPendingPublicationApproval`
    /* @notNull id challenge ownerId resourceType readableId action expectedState expiresAt */
    /* @type resourceType 'page' | 'entity' | 'asset' | 'record' */
    /* @type action 'publish' | 'unpublish' */
    select approval."id", approval."challenge", approval."owner_id" as "ownerId",
      approval."resource_type" as "resourceType", approval."readable_id" as "readableId",
      approval."action", approval."revision_number" as "revisionNumber",
      approval."expected_state" as "expectedState", approval."expires_at" as "expiresAt"
    from "publication_approval" approval
    join "auth_session" session on session."id" = approval."session_id"
      and session."userId" = approval."owner_id"
    where approval."id" = ${input.approvalId} and approval."owner_id" = ${input.ownerId}
      and approval."session_id" = ${input.sessionId} and approval."expires_at" > ${input.now}
      and session."expiresAt" > ${input.now}
  `;
  const row = rows[0];
  if (!row) {
    return null;
  }
  const target = { ownerId: row.ownerId, readableId: row.readableId };
  let request: PublicationRequest;
  if (row.resourceType === 'page') {
    request =
      row.action === 'publish'
        ? {
            ...target,
            resourceType: 'page',
            action: 'publish',
            revisionNumber: Number(row.revisionNumber),
          }
        : { ...target, resourceType: 'page', action: 'unpublish' };
  } else {
    request = { ...target, resourceType: row.resourceType, action: row.action };
  }
  return {
    id: row.id,
    challenge: row.challenge,
    request,
    expectedState: row.expectedState,
    expiresAt: row.expiresAt,
  };
}

async function authorizationExpiresAt({
  db,
  ...input
}: AuthorizationIdentity & { db: TypedSQL<Queries> }) {
  const rows = await db.FindPublicationAuthorization`
    /* @notNull expiresAt */
    select authorization."expires_at" as "expiresAt"
    from "publication_authorization" authorization
    join "auth_session" session on session."id" = authorization."session_id"
      and session."userId" = authorization."owner_id"
    join "auth_passkey" passkey on passkey."id" = authorization."passkey_id"
      and passkey."userId" = authorization."owner_id"
      and passkey."credentialID" = authorization."credential_id"
      and passkey."publicKey" = authorization."public_key"
    where authorization."session_id" = ${input.sessionId}
      and authorization."owner_id" = ${input.ownerId}
      and authorization."expires_at" > ${input.now} and session."expiresAt" > ${input.now}
  `;
  return rows[0]?.expiresAt ?? null;
}

async function consumeApproval({
  db,
  approval,
}: {
  db: TypedTransactionSQL<Queries>;
  approval: PublicationApproval;
}) {
  await db.ConsumePublicationApproval`
    delete from "publication_approval" where "id" = ${approval.id} and "owner_id" = ${approval.request.ownerId}
  `;
}

export class PublicationApprovalsRepository implements PublicationApprovalsRepositoryContract {
  private readonly sql: TypedSQL<Queries>;

  constructor(sql: SQL) {
    this.sql = withTypes<Queries>(sql);
  }

  authorizationExpiresAt(input: AuthorizationIdentity): Promise<string | null> {
    return authorizationExpiresAt({ db: this.sql, ...input });
  }

  completeAuthorizedApproval(input: ApprovalIdentity) {
    return this.sql.begin('immediate', async (db) => {
      const approval = await findApproval({ db, ...input });
      if (!approval) {
        return { state: 'approval_invalid' as const };
      }
      if (!(await authorizationExpiresAt({ db, ...input }))) {
        return { state: 'assertion_invalid' as const };
      }
      await consumeApproval({ db, approval });
      return executePublication({
        db,
        input: {
          ...approval.request,
          expectedState: approval.expectedState,
          publishedAt: input.now,
        },
      });
    });
  }

  create({
    request,
    sessionId,
    challenge,
    expectedState,
    now,
  }: Parameters<
    PublicationApprovalsRepositoryContract['create']
  >[0]): Promise<PublicationApproval | null> {
    const approval = {
      id: crypto.randomUUID(),
      challenge,
      request,
      expectedState,
      expiresAt: new Date(new Date(now).getTime() + APPROVAL_LIFETIME_MS).toISOString(),
    };
    const revisionNumber = 'revisionNumber' in request ? request.revisionNumber : null;
    return this.sql.begin('immediate', async (db) => {
      await db.DeleteExpiredPublicationApprovals`
        delete from "publication_approval" where "owner_id" = ${request.ownerId} and "expires_at" <= ${now}
      `;
      const rows = await db.CreatePublicationApproval`
        insert into "publication_approval"
          ("id", "owner_id", "session_id", "challenge", "resource_type", "readable_id", "action",
           "revision_number", "expected_state", "expires_at")
        select ${approval.id}, ${request.ownerId}, ${sessionId}, ${challenge}, ${request.resourceType},
          ${request.readableId}, ${request.action}, ${revisionNumber}, ${expectedState}, ${approval.expiresAt}
        from "auth_session" session
        where session."id" = ${sessionId} and session."userId" = ${request.ownerId} and session."expiresAt" > ${now}
          and (${request.resourceType} != 'page' or ${request.action} != 'publish' or exists (
            select 1 from "knowledge_page_revision" revision
            join "knowledge_page" page on page."id" = revision."page_id" and page."owner_id" = revision."owner_id"
            where page."owner_id" = ${request.ownerId} and page."readable_id" = ${request.readableId}
              and page."archived_at" is null and revision."revision_number" = ${revisionNumber}
          ))
        returning "id"
      `;
      return rows.length ? approval : null;
    });
  }

  find(input: ApprovalIdentity): Promise<PublicationApproval | null> {
    return findApproval({ db: this.sql, ...input });
  }

  async credentials({ ownerId }: { ownerId: string }): Promise<PublicationCredential[]> {
    const rows = await this.sql.ListPublicationCredentials`
      /* @notNull credentialId */
      select "id", "credentialID" as "credentialId", "publicKey", "counter", "transports"
      from "auth_passkey" where "userId" = ${ownerId}
      order by "id"
    `;
    return rows.map((row) => ({ ...row, counter: Number(row.counter) }));
  }

  completeVerifiedApproval(
    input: ApprovalIdentity & { credential: PublicationCredential; newCounter: number },
  ): Promise<PublicationApprovalResult> {
    return this.sql.begin('immediate', async (db) => {
      const approval = await findApproval({ db, ...input });
      if (!approval) {
        return { state: 'approval_invalid' };
      }
      // A verified attempt is single-use even if its credential or reviewed state has changed.
      await consumeApproval({ db, approval });
      const { credential, newCounter } = input;
      if (
        !Number.isSafeInteger(newCounter) ||
        newCounter < 0 ||
        (newCounter <= credential.counter && !(newCounter === 0 && credential.counter === 0))
      ) {
        return { state: 'credential_changed' };
      }
      const updated = await db.AdvancePublicationCredentialCounter`
        update "auth_passkey" set "counter" = ${newCounter}
        where "id" = ${credential.id} and "userId" = ${input.ownerId}
          and "credentialID" = ${credential.credentialId} and "publicKey" = ${credential.publicKey}
          and "counter" = ${credential.counter}
        returning "id"
      `;
      if (!updated.length) {
        return { state: 'credential_changed' };
      }
      const result = await executePublication({
        db,
        input: {
          ...approval.request,
          expectedState: approval.expectedState,
          publishedAt: input.now,
        },
      });
      if (result.state === 'changed' || result.state === 'unchanged') {
        const expiresAt = new Date(
          new Date(input.now).getTime() + AUTHORIZATION_LIFETIME_MS,
        ).toISOString();
        await db.GrantPublicationAuthorization`
          insert into "publication_authorization"
            ("session_id", "owner_id", "passkey_id", "credential_id", "public_key", "expires_at")
          values (${input.sessionId}, ${input.ownerId}, ${credential.id}, ${credential.credentialId}, ${credential.publicKey}, ${expiresAt})
          on conflict ("session_id") do update set
            "owner_id" = excluded."owner_id", "passkey_id" = excluded."passkey_id",
            "credential_id" = excluded."credential_id", "public_key" = excluded."public_key",
            "expires_at" = excluded."expires_at"
        `;
      }
      return result;
    });
  }
}
