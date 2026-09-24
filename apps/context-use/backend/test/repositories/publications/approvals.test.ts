import { expect, test } from 'bun:test';
import { betterAuth } from 'better-auth';
import type { SQL } from 'bun';
import { createAuthOptions } from '#backend/lib/auth/better-auth.ts';
import {
  type PublicationApproval,
  PublicationApprovalsRepository,
  type PublicationCredential,
} from '#backend/repositories/publications/approvals.ts';
import {
  type PublicationRequest,
  PublicationsRepository,
} from '#backend/repositories/publications/repository.ts';
import { HASH, LATER, NOW, withDatabase } from './database.ts';

const OWNER = 'owner-a';
const EXPIRES = '2026-09-24T09:05:00.000Z';
const BEFORE_EXPIRY = '2026-09-24T09:04:59.999Z';
const COUNTER = 7;
const NEXT_COUNTER = 8;
const FURTHER_COUNTER = 9;
const FRACTIONAL_COUNTER = 1.5;
const REQUEST: PublicationRequest = {
  ownerId: OWNER,
  resourceType: 'asset',
  readableId: 'primary',
  action: 'publish',
};

async function withApprovals(
  run: (fixture: {
    database: SQL;
    approvals: PublicationApprovalsRepository;
    publications: PublicationsRepository;
    sessionId: string;
    otherSessionId: string;
    credential: PublicationCredential;
    create: (request?: PublicationRequest) => Promise<PublicationApproval>;
    complete: (
      approval: PublicationApproval,
    ) => ReturnType<PublicationApprovalsRepository['completeVerifiedApproval']>;
  }) => Promise<void>,
) {
  await withDatabase(async ({ database }) => {
    const auth = betterAuth(
      createAuthOptions({
        database,
        baseUrl: new URL('http://localhost:3000'),
        secret: 'test-secret-at-least-thirty-two-characters',
        fetchClientMetadataResource: async () => new Response(null, { status: 503 }),
      }),
    );
    const { internalAdapter } = await auth.$context;
    const session = await internalAdapter.createSession(
      OWNER,
      false,
      {
        expiresAt: new Date(LATER),
      },
      true,
    );
    const otherSession = await internalAdapter.createSession(
      OWNER,
      false,
      {
        expiresAt: new Date(LATER),
      },
      true,
    );
    for (const ownerId of [OWNER, 'owner-b']) {
      await database`
        insert into "auth_passkey"
          ("id", "userId", "credentialID", "publicKey", "counter", "deviceType", "backedUp", "transports")
        values (${`${ownerId}-passkey`}, ${ownerId}, ${`${ownerId}-credential`}, 'public-key', ${COUNTER},
          'singleDevice', 0, 'internal,hybrid')
      `;
    }
    const approvals = new PublicationApprovalsRepository(database);
    const publications = new PublicationsRepository(database);
    const [credential] = await approvals.credentials({ ownerId: OWNER });
    if (!credential) {
      throw new Error('Expected owner credential');
    }
    const create = async (request = REQUEST) => {
      const prepared = await publications.prepare(request);
      if (!prepared) {
        throw new Error('Expected publication target');
      }
      const approval = await approvals.create({
        request,
        sessionId: session.id,
        challenge: crypto.randomUUID(),
        expectedState: prepared.expectedState,
        now: NOW,
      });
      if (!approval) {
        throw new Error('Expected approval');
      }
      return approval;
    };
    await run({
      database,
      approvals,
      publications,
      sessionId: session.id,
      otherSessionId: otherSession.id,
      credential,
      create,
      complete: (approval) =>
        approvals.completeVerifiedApproval({
          ownerId: OWNER,
          sessionId: session.id,
          approvalId: approval.id,
          credential,
          newCounter: NEXT_COUNTER,
          now: NOW,
        }),
    });
  });
}

test('approvals bind owner and session and expire after five minutes using Better Auth session dates', async () => {
  await withApprovals(
    async ({ database, approvals, sessionId, otherSessionId, create, credential }) => {
      expect(
        await database<
          { expiresAt: string }[]
        >`select "expiresAt" from "auth_session" where "id" = ${sessionId}`,
      ).toEqual([{ expiresAt: LATER }]);
      const approval = await create();
      expect(approval.expiresAt).toBe(EXPIRES);
      expect(
        await approvals.find({
          ownerId: OWNER,
          sessionId,
          approvalId: approval.id,
          now: BEFORE_EXPIRY,
        }),
      ).toEqual(approval);
      for (const input of [
        { ownerId: 'owner-b', sessionId, now: NOW },
        { ownerId: OWNER, sessionId: otherSessionId, now: NOW },
        { ownerId: OWNER, sessionId, now: EXPIRES },
      ]) {
        expect(await approvals.find({ ...input, approvalId: approval.id })).toBeNull();
        expect(
          await approvals.completeVerifiedApproval({
            ...input,
            approvalId: approval.id,
            credential,
            newCounter: NEXT_COUNTER,
          }),
        ).toEqual({ state: 'approval_invalid' });
      }
      expect(
        await database`select "public_id" from "asset" where "public_id" is not null`,
      ).toHaveLength(0);
      expect((await approvals.credentials({ ownerId: OWNER }))[0]?.counter).toBe(COUNTER);
      expect(
        await approvals.find({ ownerId: OWNER, sessionId, approvalId: approval.id, now: NOW }),
      ).toEqual(approval);
      expect(
        await approvals.create({
          request: { ...REQUEST, ownerId: 'owner-b' },
          sessionId,
          challenge: 'wrong-owner',
          expectedState: '',
          now: NOW,
        }),
      ).toBeNull();
      await database`update "auth_session" set "expiresAt" = ${NOW} where "id" = ${sessionId}`;
      expect(
        await approvals.find({ ownerId: OWNER, sessionId, approvalId: approval.id, now: NOW }),
      ).toBeNull();
      expect(
        await approvals.create({
          request: REQUEST,
          sessionId,
          challenge: 'expired-session',
          expectedState: '',
          now: NOW,
        }),
      ).toBeNull();
    },
  );
});

test('completion applies only the stored target and action once', async () => {
  await withApprovals(async ({ approvals, publications, create, complete, sessionId }) => {
    expect(await approvals.credentials({ ownerId: 'missing' })).toEqual([]);
    expect((await approvals.credentials({ ownerId: OWNER })).map(({ id }) => id)).toEqual([
      'owner-a-passkey',
    ]);
    const approval = await create();
    expect(approval.request).toEqual(REQUEST);
    expect(await complete(approval)).toMatchObject({
      state: 'changed',
      publication: { publishedAt: NOW },
    });
    expect(await complete(approval)).toEqual({ state: 'approval_invalid' });
    expect(
      await approvals.find({ ownerId: OWNER, sessionId, approvalId: approval.id, now: NOW }),
    ).toBeNull();
    expect(await publications.assetStatus({ ownerId: OWNER, readableId: 'secondary' })).toEqual({
      publicId: null,
      publishedAt: null,
    });
    const withdrawn = await create({ ...REQUEST, action: 'unpublish' });
    const [currentCredential] = await approvals.credentials({ ownerId: OWNER });
    expect(
      await approvals.completeVerifiedApproval({
        ownerId: OWNER,
        sessionId,
        approvalId: withdrawn.id,
        credential: currentCredential!,
        newCounter: FURTHER_COUNTER,
        now: NOW,
      }),
    ).toMatchObject({ state: 'changed', publication: { publishedAt: null } });
    expect((await publications.assetStatus(REQUEST))?.publishedAt).toBeNull();
  });
});

test('page approvals retain the selected revision when a newer draft is saved', async () => {
  await withApprovals(async ({ database, create, complete }) => {
    const approval = await create({
      ...REQUEST,
      resourceType: 'page',
      action: 'publish',
      revisionNumber: 1,
    });
    await database`
      insert into "knowledge_page_revision"
        ("id", "page_id", "owner_id", "revision_number", "title", "excerpt", "storage_key",
         "size_bytes", "content_hash", "author_kind", "author_name", "created_at")
      values ('new-draft', 'owner-a-page-primary', ${OWNER}, 2, 'New draft', '', 'new-draft', 1,
        ${HASH}, 'owner', 'Owner', ${NOW})
    `;
    await database`update "knowledge_page" set "current_revision_id" = 'new-draft' where "id" = 'owner-a-page-primary'`;
    expect(await complete(approval)).toMatchObject({ state: 'changed' });
    expect(
      await database<
        { revision_id: string }[]
      >`select "published_revision_id" as "revision_id" from "knowledge_page" where "public_id" is not null`,
    ).toEqual([{ revision_id: 'owner-a-page-primary-revision' }]);
  });
});

test('deleting and replacing the authenticated session invalidates a verifier read', async () => {
  await withApprovals(async ({ database, approvals, create, complete, sessionId }) => {
    const approval = await create();
    expect(
      await approvals.find({ ownerId: OWNER, sessionId, approvalId: approval.id, now: NOW }),
    ).toEqual(approval);
    await database`delete from "auth_session" where "id" = ${sessionId}`;
    await database`
      insert into "auth_session" ("id", "userId", "token", "createdAt", "updatedAt", "expiresAt")
      values (${sessionId}, ${OWNER}, 'replacement-token', ${NOW}, ${NOW}, ${LATER})
    `;
    expect(await complete(approval)).toEqual({ state: 'approval_invalid' });
    expect(await database`select * from "publication_approval"`).toHaveLength(0);
    expect(
      await database`select "public_id" from "asset" where "public_id" is not null`,
    ).toHaveLength(0);
    expect((await approvals.credentials({ ownerId: OWNER }))[0]?.counter).toBe(COUNTER);
  });
});

test.each(['deleted', 'replaced', 'owner', 'key', 'credential-id', 'counter'] as const)(
  'completion rejects a credential whose %s state changed after verification',
  async (change) => {
    await withApprovals(async ({ database, create, complete }) => {
      const approval = await create();
      if (change === 'deleted' || change === 'replaced') {
        await database`delete from "auth_passkey" where "id" = 'owner-a-passkey'`;
        if (change === 'replaced') {
          await database`
            insert into "auth_passkey" ("id", "userId", "credentialID", "publicKey", "counter", "deviceType", "backedUp")
            values ('replacement-passkey', ${OWNER}, 'owner-a-credential', 'public-key', ${COUNTER}, 'singleDevice', 0)
          `;
        }
      } else if (change === 'owner') {
        await database`update "auth_passkey" set "userId" = 'owner-b' where "id" = 'owner-a-passkey'`;
      } else if (change === 'key') {
        await database`update "auth_passkey" set "publicKey" = 'replacement-key' where "id" = 'owner-a-passkey'`;
      } else if (change === 'credential-id') {
        await database`update "auth_passkey" set "credentialID" = 'replacement-credential' where "id" = 'owner-a-passkey'`;
      } else {
        await database`update "auth_passkey" set "counter" = ${FURTHER_COUNTER} where "id" = 'owner-a-passkey'`;
      }
      const before = await database`select * from "auth_passkey" order by "id"`;
      expect(await complete(approval)).toEqual({ state: 'credential_changed' });
      expect(await complete(approval)).toEqual({ state: 'approval_invalid' });
      expect(await database`select * from "auth_passkey" order by "id"`).toEqual(before);
      expect(
        await database`select "public_id" from "asset" where "public_id" is not null`,
      ).toHaveLength(0);
    });
  },
);

test('zero-counter authenticators work while approval reuse still fails', async () => {
  await withApprovals(async ({ database, approvals, create, sessionId, credential }) => {
    await database`update "auth_passkey" set "counter" = 0 where "id" = ${credential.id}`;
    const approval = await create();
    const input = {
      ownerId: OWNER,
      sessionId,
      approvalId: approval.id,
      credential: { ...credential, counter: 0 },
      newCounter: 0,
      now: NOW,
    };
    expect(await approvals.completeVerifiedApproval(input)).toMatchObject({ state: 'changed' });
    expect(await approvals.completeVerifiedApproval(input)).toEqual({ state: 'approval_invalid' });
    expect((await approvals.credentials({ ownerId: OWNER }))[0]?.counter).toBe(0);
  });
});

test.each([COUNTER, COUNTER - 1, -1, FRACTIONAL_COUNTER])(
  'counter %s cannot regress or bypass counter advancement',
  async (newCounter) => {
    await withApprovals(async ({ database, approvals, create, credential, sessionId }) => {
      const approval = await create();
      expect(
        await approvals.completeVerifiedApproval({
          ownerId: OWNER,
          sessionId,
          approvalId: approval.id,
          credential,
          newCounter,
          now: NOW,
        }),
      ).toEqual({ state: 'credential_changed' });
      expect((await approvals.credentials({ ownerId: OWNER }))[0]?.counter).toBe(COUNTER);
      expect(
        await database`select "public_id" from "asset" where "public_id" is not null`,
      ).toHaveLength(0);
    });
  },
);

test('stale reviewed content consumes approval without changing publication', async () => {
  await withApprovals(async ({ database, approvals, create, complete }) => {
    const approval = await create();
    await database`update "asset" set "name" = 'Changed since review' where "id" = 'owner-a-asset-primary'`;
    expect(await complete(approval)).toEqual({ state: 'state_changed' });
    expect(await complete(approval)).toEqual({ state: 'approval_invalid' });
    expect(
      await database`select "public_id" from "asset" where "public_id" is not null`,
    ).toHaveLength(0);
    expect((await approvals.credentials({ ownerId: OWNER }))[0]?.counter).toBe(NEXT_COUNTER);
  });
});

test('a dependency becoming private consumes approval and prevents publication', async () => {
  await withApprovals(async ({ database, approvals, publications, create, complete }) => {
    const prepared = await publications.prepare(REQUEST);
    await publications.execute({
      ...REQUEST,
      expectedState: prepared!.expectedState,
      publishedAt: NOW,
    });
    await database`
      insert into "knowledge_page_asset_usage" ("owner_id", "source_revision_id", "target_asset_id", "presentation")
      values (${OWNER}, 'owner-a-page-primary-revision', 'owner-a-asset-primary', 'attachment')
    `;
    const approval = await create({
      ...REQUEST,
      resourceType: 'page',
      action: 'publish',
      revisionNumber: 1,
    });
    await database`update "asset" set "published_at" = null where "id" = 'owner-a-asset-primary'`;
    expect(await complete(approval)).toMatchObject({
      state: 'blocked',
      blockers: [{ reason: 'reference_not_public' }],
    });
    expect(await complete(approval)).toEqual({ state: 'approval_invalid' });
    expect(
      await database`select "public_id" from "knowledge_page" where "public_id" is not null`,
    ).toHaveLength(0);
    expect((await approvals.credentials({ ownerId: OWNER }))[0]?.counter).toBe(NEXT_COUNTER);
  });
});

test('SQL failure rolls back consumption, credential advancement, and included-image publication', async () => {
  await withApprovals(async ({ database, approvals, create, complete, sessionId }) => {
    await database`update "entity" set "image_asset_id" = 'owner-a-asset-primary' where "id" = 'owner-a-entity-primary'`;
    const approval = await create({ ...REQUEST, resourceType: 'entity' });
    await database.unsafe(`create trigger reject_test_publication before update of "published_at" on "entity"
      begin select raise(abort, 'test publication failure'); end`);
    await expect(complete(approval)).rejects.toThrow('test publication failure');
    expect(
      await approvals.find({ ownerId: OWNER, sessionId, approvalId: approval.id, now: NOW }),
    ).toEqual(approval);
    expect((await approvals.credentials({ ownerId: OWNER }))[0]?.counter).toBe(COUNTER);
    expect(
      await database`select "public_id" from "asset" where "public_id" is not null`,
    ).toHaveLength(0);
    expect(
      await database`select "public_id" from "entity" where "public_id" is not null`,
    ).toHaveLength(0);
    await database.unsafe('drop trigger reject_test_publication');
    expect(await complete(approval)).toMatchObject({ state: 'changed' });
    expect(
      await database<
        { published_at: string }[]
      >`select "published_at" from "asset" where "public_id" is not null`,
    ).toEqual([{ published_at: NOW }]);
  });
});

test('two approvals verified against one counter cannot overwrite each other', async () => {
  await withApprovals(
    async ({ approvals, publications, create, complete, sessionId, credential }) => {
      const first = await create();
      const second = await create({ ...REQUEST, readableId: 'secondary' });
      expect(await complete(first)).toMatchObject({ state: 'changed' });
      expect(
        await approvals.completeVerifiedApproval({
          ownerId: OWNER,
          sessionId,
          approvalId: second.id,
          credential,
          newCounter: FURTHER_COUNTER,
          now: NOW,
        }),
      ).toEqual({ state: 'credential_changed' });
      expect((await approvals.credentials({ ownerId: OWNER }))[0]?.counter).toBe(NEXT_COUNTER);
      expect(
        (await publications.assetStatus({ ownerId: OWNER, readableId: 'secondary' }))?.publishedAt,
      ).toBeNull();
      expect(await complete(second)).toEqual({ state: 'approval_invalid' });
    },
  );
});
