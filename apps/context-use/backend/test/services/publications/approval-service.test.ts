import { expect, test } from 'bun:test';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { betterAuth } from 'better-auth';
import type { SQL } from 'bun';
import { createAuth, createAuthOptions } from '#backend/lib/auth/better-auth.ts';
import { passkeyConfiguration } from '#backend/lib/auth/passkey-configuration.ts';
import { PublicationApprovalsRepository } from '#backend/repositories/publications/approvals.ts';
import {
  type PublicationRequest,
  PublicationsRepository,
} from '#backend/repositories/publications/repository.ts';
import {
  type PublicationApprovalBeginResult,
  PublicationApprovalService,
} from '#backend/services/publications/approval-service.ts';
import { LATER, NOW, withDatabase } from '../../repositories/publications/database.ts';
import { testPasskey } from '../../support/test-passkey.ts';

const OWNER = 'owner-a';
const RP_ID = 'original.nibrun.app';
const ORIGIN = 'https://knowledge.example.com';
const EXPIRES = '2026-09-24T09:05:00.000Z';
const USER_PRESENT = 0x01;
const USER_VERIFIED = 0x04;
const REQUEST: PublicationRequest = {
  ownerId: OWNER,
  resourceType: 'asset',
  readableId: 'primary',
  action: 'publish',
};
const PASSKEYS = passkeyConfiguration({ baseUrl: new URL(ORIGIN), nibrunHostname: RP_ID });
type Ready = Extract<PublicationApprovalBeginResult, { state: 'ready' }>;

function ready(result: PublicationApprovalBeginResult): Ready {
  expect(result.state).toBe('ready');
  if (result.state !== 'ready') {
    throw new Error('Expected publication approval');
  }
  return result;
}

async function withApprovalService(
  run: (fixture: {
    database: SQL;
    service: PublicationApprovalService;
    publications: PublicationsRepository;
    approvals: PublicationApprovalsRepository;
    passkey: ReturnType<typeof testPasskey>;
    foreignPasskey: ReturnType<typeof testPasskey>;
    sessionId: string;
    identity: { ownerId: string; sessionId: string };
    begin: (request?: PublicationRequest) => Promise<Ready>;
    assertion: (approval: Ready) => AuthenticationResponseJSON;
    setTime: (time: string) => void;
  }) => Promise<void>,
) {
  await withDatabase(async ({ database }) => {
    const auth = betterAuth(
      createAuthOptions({
        database,
        baseUrl: new URL(ORIGIN),
        nibrunHostname: RP_ID,
        secret: 'test-secret-at-least-thirty-two-characters',
        fetchClientMetadataResource: async () => new Response(null, { status: 503 }),
      }),
    );
    const { internalAdapter } = await auth.$context;
    const session = await internalAdapter.createSession(
      OWNER,
      false,
      { expiresAt: new Date(LATER) },
      true,
    );
    const passkey = testPasskey(RP_ID);
    const foreignPasskey = testPasskey(RP_ID);
    for (const [ownerId, device] of [
      [OWNER, passkey],
      ['owner-b', foreignPasskey],
    ] as const) {
      await database`
        insert into "auth_passkey"
          ("id", "userId", "credentialID", "publicKey", "counter", "deviceType", "backedUp")
        values (${`${ownerId}-key`}, ${ownerId}, ${device.id}, ${device.publicKey}, 0, 'singleDevice', 0)
      `;
    }
    const approvals = new PublicationApprovalsRepository(database);
    const publications = new PublicationsRepository(database);
    let time = NOW;
    const service = new PublicationApprovalService({
      approvals,
      publications,
      passkeys: PASSKEYS,
      now: () => new Date(time),
    });
    await run({
      database,
      service,
      publications,
      approvals,
      passkey,
      foreignPasskey,
      sessionId: session.id,
      identity: { ownerId: OWNER, sessionId: session.id },
      begin: async (request = REQUEST) =>
        ready(await service.begin({ request, sessionId: session.id })),
      assertion: (approval) =>
        passkey.authentication({ origin: ORIGIN, challenge: approval.options.challenge }),
      setTime: (value) => {
        time = value;
      },
    });
  });
}

test('fresh required-UV approvals publish and unpublish using counter-zero and advancing passkeys', async () => {
  await withApprovalService(
    async ({ begin, service, identity, assertion, publications, approvals }) => {
      const publish = await begin();
      expect(publish.options).toMatchObject({ rpId: RP_ID, userVerification: 'required' });
      expect(publish.options.allowCredentials).toHaveLength(1);
      const signed = assertion(publish);
      const changed = await service.complete({
        ...identity,
        approvalId: publish.approvalId,
        assertion: signed,
      });
      expect(changed.state).toBe('changed');
      const publicState = await publications.assetStatus(REQUEST);
      expect(publicState?.publishedAt).toBe(NOW);
      expect((await approvals.credentials({ ownerId: OWNER }))[0]?.counter).toBe(0);
      expect(
        await service.complete({ ...identity, approvalId: publish.approvalId, assertion: signed }),
      ).toEqual({ state: 'approval_invalid' });

      const unpublish = await begin({ ...REQUEST, action: 'unpublish' });
      expect(unpublish.options.challenge).not.toBe(publish.options.challenge);
      expect(
        await service.complete({
          ...identity,
          approvalId: unpublish.approvalId,
          assertion: signed,
        }),
      ).toEqual({ state: 'assertion_invalid' });
      expect(await publications.assetStatus(REQUEST)).toEqual(publicState);
      expect(
        (
          await service.complete({
            ...identity,
            approvalId: unpublish.approvalId,
            assertion: assertion(unpublish),
          })
        ).state,
      ).toBe('changed');
      expect(await publications.assetStatus(REQUEST)).toEqual({
        publicId: publicState!.publicId,
        publishedAt: null,
      });
      expect((await approvals.credentials({ ownerId: OWNER }))[0]?.counter).toBe(1);
    },
  );
});

for (const failure of [
  'challenge',
  'origin',
  'rp',
  'owner-key',
  'uv',
  'presence',
  'signature',
] as const) {
  test(`rejects a signed assertion with invalid ${failure} without publishing`, async () => {
    await withApprovalService(
      async ({ begin, service, identity, passkey, foreignPasskey, database, publications }) => {
        const approval = await begin();
        let device = passkey;
        if (failure === 'owner-key') {
          device = foreignPasskey;
        }
        if (failure === 'rp') {
          device = testPasskey('attacker.example.com');
          await database`update "auth_passkey" set "credentialID" = ${device.id}, "publicKey" = ${device.publicKey} where "userId" = ${OWNER}`;
        }
        const assertion = device.authentication({
          origin: failure === 'origin' ? 'https://attacker.example.com' : ORIGIN,
          challenge:
            failure === 'challenge'
              ? 'unrelated-authentication-challenge'
              : approval.options.challenge,
          flags:
            failure === 'uv' ? USER_PRESENT : failure === 'presence' ? USER_VERIFIED : undefined,
        });
        if (failure === 'signature') {
          assertion.response.signature = foreignPasskey.authentication({
            origin: ORIGIN,
            challenge: approval.options.challenge,
          }).response.signature;
        }
        expect(
          await service.complete({ ...identity, approvalId: approval.approvalId, assertion }),
        ).toEqual({ state: 'assertion_invalid' });
        expect(await publications.assetStatus(REQUEST)).toEqual({
          publicId: null,
          publishedAt: null,
        });
      },
    );
  });
}

test('an approval cannot authorize another resource or be completed by another owner/session', async () => {
  await withApprovalService(async ({ begin, service, identity, assertion, publications }) => {
    const primary = await begin();
    const secondary = await begin({ ...REQUEST, readableId: 'secondary' });
    const signed = assertion(primary);
    expect(
      await service.complete({ ...identity, approvalId: secondary.approvalId, assertion: signed }),
    ).toEqual({ state: 'assertion_invalid' });
    for (const override of [{ ownerId: 'owner-b' }, { sessionId: 'another-session' }]) {
      expect(
        await service.complete({
          ...identity,
          ...override,
          approvalId: primary.approvalId,
          assertion: signed,
        }),
      ).toEqual({ state: 'approval_invalid' });
    }
    expect(await publications.assetStatus({ ...REQUEST, readableId: 'secondary' })).toEqual({
      publicId: null,
      publishedAt: null,
    });
    expect(
      (await service.complete({ ...identity, approvalId: primary.approvalId, assertion: signed }))
        .state,
    ).toBe('changed');
  });
});

for (const invalidation of ['expiry', 'session', 'key'] as const) {
  test(`fails closed after approval ${invalidation}`, async () => {
    await withApprovalService(
      async ({ begin, service, identity, assertion, publications, database, setTime }) => {
        const approval = await begin();
        const signed = assertion(approval);
        if (invalidation === 'expiry') {
          setTime(EXPIRES);
        } else if (invalidation === 'session') {
          await database`delete from "auth_session" where "id" = ${identity.sessionId}`;
        } else {
          await database`delete from "auth_passkey" where "userId" = ${OWNER}`;
        }
        expect(
          await service.complete({
            ...identity,
            approvalId: approval.approvalId,
            assertion: signed,
          }),
        ).toEqual({ state: invalidation === 'key' ? 'assertion_invalid' : 'approval_invalid' });
        expect(await publications.assetStatus(REQUEST)).toEqual({
          publicId: null,
          publishedAt: null,
        });
      },
    );
  });
}

test('commit uses server time obtained after cryptographic verification', async () => {
  await withApprovalService(async ({ begin, approvals, publications, identity, assertion }) => {
    const approval = await begin();
    let firstRead = true;
    const service = new PublicationApprovalService({
      approvals,
      publications,
      passkeys: PASSKEYS,
      now: () => {
        const time = firstRead ? NOW : EXPIRES;
        firstRead = false;
        return new Date(time);
      },
    });
    expect(
      await service.complete({
        ...identity,
        approvalId: approval.approvalId,
        assertion: assertion(approval),
      }),
    ).toEqual({ state: 'approval_invalid' });
    expect(await publications.assetStatus(REQUEST)).toEqual({ publicId: null, publishedAt: null });
  });
});

test('a changed reviewed resource consumes approval without publishing', async () => {
  await withApprovalService(
    async ({ begin, service, identity, assertion, database, publications }) => {
      const approval = await begin();
      await database`update "asset" set "name" = 'Changed' where "owner_id" = ${OWNER} and "readable_id" = 'primary'`;
      const signed = assertion(approval);
      expect(
        await service.complete({ ...identity, approvalId: approval.approvalId, assertion: signed }),
      ).toEqual({ state: 'state_changed' });
      expect(
        await service.complete({ ...identity, approvalId: approval.approvalId, assertion: signed }),
      ).toEqual({ state: 'approval_invalid' });
      expect(await publications.assetStatus(REQUEST)).toEqual({
        publicId: null,
        publishedAt: null,
      });
    },
  );
});

test('blocked operations do not create a passkey ceremony', async () => {
  await withApprovalService(async ({ service, sessionId, database }) => {
    await database`insert into "knowledge_page_entity_mention" ("source_revision_id", "target_entity_id", "owner_id") values ('owner-a-page-primary-revision', 'owner-a-entity-primary', ${OWNER})`;
    const result = await service.begin({
      request: {
        ownerId: OWNER,
        resourceType: 'page',
        readableId: 'primary',
        action: 'publish',
        revisionNumber: 1,
      },
      sessionId,
    });
    expect(result.state).toBe('blocked');
    expect(await database`select "id" from "publication_approval"`).toHaveLength(0);
  });
});

test('begin requires a current session, passkey and existing resource', async () => {
  await withApprovalService(async ({ service, sessionId, database }) => {
    expect(
      await service.begin({ request: { ...REQUEST, readableId: 'missing' }, sessionId }),
    ).toEqual({ state: 'not_found' });
    expect(await service.begin({ request: REQUEST, sessionId: 'missing' })).toEqual({
      state: 'approval_invalid',
    });
    await database`delete from "auth_passkey" where "userId" = ${OWNER}`;
    expect(await service.begin({ request: REQUEST, sessionId })).toEqual({
      state: 'passkey_required',
    });
  });
});

test('database failures propagate and leave publication and approval unchanged', async () => {
  await withApprovalService(
    async ({ begin, service, identity, assertion, database, publications, approvals }) => {
      const approval = await begin();
      await database.unsafe(
        `create trigger fail_publication before update of "published_at" on "asset" begin select raise(abort, 'publication failed'); end`,
      );
      expect(
        service.complete({
          ...identity,
          approvalId: approval.approvalId,
          assertion: assertion(approval),
        }),
      ).rejects.toThrow('publication failed');
      expect(await publications.assetStatus(REQUEST)).toEqual({
        publicId: null,
        publishedAt: null,
      });
      expect(
        await approvals.find({ ...identity, approvalId: approval.approvalId, now: NOW }),
      ).not.toBeNull();
    },
  );
});

test('a real login challenge cannot approve publication', async () => {
  await withApprovalService(
    async ({ begin, service, identity, passkey, database, publications }) => {
      const approval = await begin();
      const auth = createAuth({
        database,
        baseUrl: new URL(ORIGIN),
        nibrunHostname: RP_ID,
        secret: 'test-secret-at-least-thirty-two-characters',
        fetchClientMetadataResource: async () => new Response(null, { status: 503 }),
      });
      const loginOptions = await auth.handler(
        new Request(`${ORIGIN}/api/auth/passkey/generate-authenticate-options`, {
          headers: { origin: ORIGIN },
        }),
      );
      expect(loginOptions.ok).toBe(true);
      const { challenge } = await loginOptions.json();
      expect(
        await service.complete({
          ...identity,
          approvalId: approval.approvalId,
          assertion: passkey.authentication({ origin: ORIGIN, challenge }),
        }),
      ).toEqual({ state: 'assertion_invalid' });
      expect(await publications.assetStatus(REQUEST)).toEqual({
        publicId: null,
        publishedAt: null,
      });
    },
  );
});

test('a credential removed after verification input is read cannot approve publication', async () => {
  await withApprovalService(
    async ({ begin, approvals, publications, database, identity, assertion }) => {
      const approval = await begin();
      const service = new PublicationApprovalService({
        publications,
        passkeys: PASSKEYS,
        now: () => new Date(NOW),
        approvals: {
          create: (input) => approvals.create(input),
          find: (input) => approvals.find(input),
          completeVerifiedApproval: (input) => approvals.completeVerifiedApproval(input),
          credentials: async (input) => {
            const credentials = await approvals.credentials(input);
            await database`delete from "auth_passkey" where "userId" = ${OWNER}`;
            return credentials;
          },
        },
      });
      expect(
        await service.complete({
          ...identity,
          approvalId: approval.approvalId,
          assertion: assertion(approval),
        }),
      ).toEqual({ state: 'credential_changed' });
      expect(await publications.assetStatus(REQUEST)).toEqual({
        publicId: null,
        publishedAt: null,
      });
      expect(
        await approvals.find({ ...identity, approvalId: approval.approvalId, now: NOW }),
      ).toBeNull();
    },
  );
});
