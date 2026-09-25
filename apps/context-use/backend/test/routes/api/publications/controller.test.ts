import { expect, test } from 'bun:test';
import { treaty } from '@elysiajs/eden';
import type { Static } from 'elysia';
import { Elysia, StatusMap } from 'elysia';
import { createAuth } from '#backend/lib/auth/better-auth.ts';
import { passkeyConfiguration } from '#backend/lib/auth/passkey-configuration.ts';
import { elysiaErrorHandler } from '#backend/lib/errors.ts';
import { ApiKeysRepository } from '#backend/repositories/api-keys/repository.ts';
import { PublicationApprovalsRepository } from '#backend/repositories/publications/approvals.ts';
import { PublicationsRepository } from '#backend/repositories/publications/repository.ts';
import { createPublicationsController } from '#backend/routes/api/publications/controller.ts';
import type { PublicationReadySchema } from '#backend/routes/api/publications/model.ts';
import { ApiKeysService } from '#backend/services/api-keys/service.ts';
import { PublicationApprovalService } from '#backend/services/publications/approval-service.ts';
import { HASH, LATER, NOW, withDatabase } from '../../../repositories/publications/database.ts';
import { testPasskey } from '../../../support/test-passkey.ts';

const ORIGIN = 'https://knowledge.example.com';
const RP_ID = 'original.nibrun.app';
const NON_INTEGER_REVISION = 1.5;
const USER_PRESENT = 0x01;
const ASSET = { resourceType: 'asset', readableId: 'primary', action: 'publish' };
type Ready = Static<typeof PublicationReadySchema>;

const cookieHeader = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');

async function withController(
  run: (fixture: Awaited<ReturnType<typeof controllerFixture>>) => Promise<void>,
) {
  await withDatabase(async ({ database }) => run(await controllerFixture(database)));
}

async function controllerFixture(database: Parameters<typeof createAuth>[0]['database']) {
  const auth = createAuth({
    database,
    baseUrl: new URL(ORIGIN),
    nibrunHostname: RP_ID,
    secret: 'test-secret-at-least-thirty-two-characters',
    fetchClientMetadataResource: async () =>
      new Response(null, { status: StatusMap['Service Unavailable'] }),
  });
  const passkey = testPasskey(RP_ID);
  const foreignPasskey = testPasskey(RP_ID);
  for (const [owner, key] of [
    ['owner-a', passkey],
    ['owner-b', foreignPasskey],
  ] as const) {
    await database`insert into "auth_passkey" ("id", "userId", "credentialID", "publicKey", "counter", "deviceType", "backedUp") values (${`${owner}-key`}, ${owner}, ${key.id}, ${key.publicKey}, 0, 'singleDevice', 0)`;
  }
  async function login(device = passkey) {
    const options = await auth.handler(
      new Request(`${ORIGIN}/api/auth/passkey/generate-authenticate-options`, {
        headers: { origin: ORIGIN },
      }),
    );
    const { challenge } = await options.json();
    const response = await auth.handler(
      new Request(`${ORIGIN}/api/auth/passkey/verify-authentication`, {
        method: 'POST',
        headers: {
          origin: ORIGIN,
          cookie: cookieHeader(options),
          'content-type': 'application/json',
        },
        body: JSON.stringify({ response: device.authentication({ origin: ORIGIN, challenge }) }),
      }),
    );
    expect(response.status).toBe(StatusMap.OK);
    return cookieHeader(response);
  }
  const cookie = await login();
  const publications = new PublicationsRepository(database);
  let time = NOW;
  const service = new PublicationApprovalService({
    publications,
    approvals: new PublicationApprovalsRepository(database),
    passkeys: passkeyConfiguration({ baseUrl: new URL(ORIGIN), nibrunHostname: RP_ID }),
    now: () => new Date(time),
  });
  const app = new Elysia()
    .onError(elysiaErrorHandler)
    .group('/api', (app) =>
      app.use(createPublicationsController({ auth, publicationApprovalService: service })),
    );
  const request = ({
    path,
    body,
    headers = { cookie },
  }: {
    path: string;
    body?: unknown;
    headers?: HeadersInit;
  }) =>
    app.handle(
      new Request(`${ORIGIN}/api/publications${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: new Headers({
          'content-type': 'application/json',
          ...Object.fromEntries(new Headers(headers)),
        }),
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
  const begin = async (body: unknown = ASSET) => {
    const response = await request({ path: '/approvals', body });
    expect(response.status).toBe(StatusMap.OK);
    const result: Ready = await response.json();
    expect(result.state).toBe('ready');
    return result;
  };
  const sign = (approval: Ready) =>
    passkey.authentication({ origin: ORIGIN, challenge: approval.options.challenge });
  const complete = (approval: Ready) =>
    request({
      path: `/approvals/${approval.approvalId}/complete`,
      body: { assertion: sign(approval) },
    });
  return {
    app,
    auth,
    database,
    publications,
    passkey,
    foreignPasskey,
    cookie,
    login,
    request,
    begin,
    sign,
    complete,
    setTime: (value: string) => {
      time = value;
    },
  };
}

test('owner HTTP approval publishes entity and its portrait, then withdraws only the entity; replay cannot mutate', async () => {
  await withController(async ({ database, begin, request, sign, complete, app, cookie }) => {
    await database`update "entity" set "name" = 'Prepared name', "description" = 'Prepared description', "entity_type" = 'organization', "image_asset_id" = 'owner-a-asset-primary' where "id" = 'owner-a-entity-primary'`;
    const approval = await begin({ ...ASSET, resourceType: 'entity' });
    expect(approval.options).toMatchObject({ rpId: RP_ID, userVerification: 'required' });
    expect(approval.preparation.includedImage?.resource).toEqual({
      resourceType: 'asset',
      readableId: 'primary',
      name: 'Asset',
    });
    expect(approval.preparation.resource).toEqual({
      resourceType: 'entity',
      readableId: 'primary',
      name: 'Prepared name',
    });
    expect(approval.preparation.entityIdentity).toEqual({
      description: 'Prepared description',
      entityType: 'organization',
    });
    expect(Object.keys(approval.preparation).sort()).toEqual([
      'blockers',
      'entityIdentity',
      'includedImage',
      'pageRevision',
      'publication',
      'resource',
    ]);
    expect(approval.preparation).not.toHaveProperty('expectedState');
    const assertion = sign(approval);
    const path = `/approvals/${approval.approvalId}/complete`;
    const result = await request({ path, body: { assertion } });
    expect(result.status).toBe(StatusMap.OK);
    expect(await result.json()).toMatchObject({
      state: 'changed',
      publication: { publishedAt: NOW },
    });
    expect((await request({ path: '/asset/primary' })).status).toBe(StatusMap.OK);
    expect(await (await request({ path: '/asset/primary' })).json()).toMatchObject({
      publishedAt: NOW,
    });
    expect((await request({ path, body: { assertion } })).status).toBe(StatusMap.Conflict);
    expect(await (await request({ path, body: { assertion } })).json()).toMatchObject({
      state: 'approval_invalid',
    });
    expect(
      (await complete(await begin({ ...ASSET, resourceType: 'entity', action: 'unpublish' })))
        .status,
    ).toBe(StatusMap.OK);
    const client = treaty(app);
    const status = await client.api
      .publications({ resourceType: 'entity' })({ readableId: 'primary' })
      .get({ headers: { cookie } });
    expect(status.data?.publishedAt).toBeNull();
    expect(await (await request({ path: '/asset/primary' })).json()).toMatchObject({
      publishedAt: NOW,
    });
  });
});

test('entity review fields come from the prepared identity and cannot approve later identity edits', async () => {
  await withController(async ({ database, begin, complete, request }) => {
    for (const [field, value] of [
      ['name', 'Updated name'],
      ['description', 'Updated description'],
      ['entity_type', 'location'],
    ] as const) {
      const approval = await begin({ ...ASSET, resourceType: 'entity' });
      await database.unsafe(
        `update "entity" set "${field}" = $1 where "id" = 'owner-a-entity-primary'`,
        [value],
      );
      const response = await complete(approval);
      expect(response.status).toBe(StatusMap.Conflict);
      expect(await response.json()).toMatchObject({ state: 'state_changed' });
      expect(await (await request({ path: '/entity/primary' })).json()).toMatchObject({
        publishedAt: null,
      });
    }
    const fresh = await begin({ ...ASSET, resourceType: 'entity' });
    expect(fresh.preparation.resource.name).toBe('Updated name');
    expect(fresh.preparation.entityIdentity).toEqual({
      description: 'Updated description',
      entityType: 'location',
    });
    expect((await complete(fresh)).status).toBe(StatusMap.OK);
  });
});

test('HTTP publication selects the exact reviewed page revision, with revision numbers and no storage or database identity in status', async () => {
  await withController(async ({ database, begin, complete, request }) => {
    await database`insert into "knowledge_page_revision" ("id", "page_id", "owner_id", "revision_number", "title", "excerpt", "storage_key", "size_bytes", "content_hash", "author_kind", "author_name", "created_at") values ('new-revision', 'owner-a-page-primary', 'owner-a', 2, 'Private title', '', 'private-storage', 1, ${HASH}, 'owner', 'Owner', ${LATER})`;
    await database`update "knowledge_page" set "current_revision_id" = 'new-revision' where "id" = 'owner-a-page-primary'`;
    const approval = await begin({ ...ASSET, resourceType: 'page', revisionNumber: 1 });
    expect(approval.preparation.resource.name).toBe('Page');
    expect(approval.preparation.pageRevision).toEqual({
      revisionNumber: 1,
      publishedRevisionNumber: null,
    });
    expect((await complete(approval)).status).toBe(StatusMap.OK);
    const status = await (await request({ path: '/page/primary' })).json();
    expect(status).toEqual({
      resourceType: 'page',
      publicId: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      ),
      publishedAt: NOW,
      publishedRevisionNumber: 1,
    });
    const newer = await begin({ ...ASSET, resourceType: 'page', revisionNumber: 2 });
    expect(newer.preparation.pageRevision).toEqual({
      revisionNumber: 2,
      publishedRevisionNumber: 1,
    });
    expect((await complete(newer)).status).toBe(StatusMap.OK);
    expect(await (await request({ path: '/page/primary' })).json()).toMatchObject({
      publishedRevisionNumber: 2,
    });
    expect(
      (await complete(await begin({ ...ASSET, resourceType: 'page', action: 'unpublish' }))).status,
    ).toBe(StatusMap.OK);
    expect(await (await request({ path: '/page/primary' })).json()).toEqual({
      resourceType: 'page',
      publicId: status.publicId,
      publishedAt: null,
      publishedRevisionNumber: null,
    });
  });
});

test('unauthenticated, API key and MCP bearer requests cannot read or begin or complete approval', async () => {
  await withController(async ({ database, begin, request, sign }) => {
    const apiKeys = new ApiKeysService({ keys: new ApiKeysRepository(database) });
    const apiKey = Bun.randomUUIDv7();
    const created = await new ApiKeysRepository(database).create({
      id: Bun.randomUUIDv7(),
      ownerId: 'owner-a',
      readableId: 'ingestion',
      name: 'Ingestion',
      apiKeySha256: new Bun.CryptoHasher('sha256').update(apiKey).digest('hex'),
      createdAt: NOW,
    });
    expect(await apiKeys.authenticate({ apiKey })).toMatchObject({ ownerId: 'owner-a' });
    expect(created.state).toBe('created');
    if (created.state !== 'created') {
      throw new Error('Expected API key');
    }
    const approval = await begin();
    for (const headers of [
      new Headers(),
      new Headers({ authorization: `Bearer ${apiKey}` }),
      new Headers({ authorization: 'Bearer mcp-access-token' }),
    ]) {
      for (const [path, body] of [
        ['/asset/primary', undefined],
        ['/approvals', ASSET],
        [`/approvals/${approval.approvalId}/complete`, { assertion: sign(approval) }],
      ] as const) {
        expect((await request({ path, body, headers })).status).toBe(StatusMap.Unauthorized);
      }
    }
    expect(await (await request({ path: '/asset/primary' })).json()).toMatchObject({
      publishedAt: null,
    });
  });
});

test('unknown and other-owner resource reads and begins are indistinguishable 404 responses', async () => {
  await withController(async ({ database, request }) => {
    for (const [type, table] of [
      ['asset', 'asset'],
      ['entity', 'entity'],
      ['page', 'knowledge_page'],
    ] as const) {
      await database.unsafe(
        `update "${table}" set "readable_id" = 'foreign-only' where "owner_id" = 'owner-b' and "readable_id" = 'primary'`,
      );
      for (const readableId of ['foreign-only', 'unknown']) {
        const status = await request({ path: `/${type}/${readableId}` });
        expect(status.status).toBe(StatusMap['Not Found']);
        expect(await status.json()).toEqual({ error: 'Resource not found' });
        const begin = await request({
          path: '/approvals',
          body: {
            ...ASSET,
            resourceType: type,
            readableId,
            ...(type === 'page' ? { revisionNumber: 1 } : {}),
          },
        });
        expect(begin.status).toBe(StatusMap['Not Found']);
        expect(await begin.json()).toEqual({ error: 'Resource not found' });
      }
    }
  });
});

test('approval is bound to the authenticated owner and session, not supplied identity', async () => {
  await withController(async ({ begin, sign, request, login, foreignPasskey, complete }) => {
    const approval = await begin();
    const assertion = sign(approval);
    for (const cookie of [await login(), await login(foreignPasskey)]) {
      const result = await request({
        path: `/approvals/${approval.approvalId}/complete`,
        body: { assertion },
        headers: { cookie },
      });
      expect(result.status).toBe(StatusMap.Conflict);
      expect(await result.json()).toMatchObject({ state: 'approval_invalid' });
    }
    expect((await complete(approval)).status).toBe(StatusMap.OK);
  });
});

test('required fields are validated and supplied identity, target, state and clock cannot replace the stored operation', async () => {
  await withController(async ({ begin, sign, request, database, publications }) => {
    for (const body of [
      { ...ASSET, resourceType: 'page' },
      { ...ASSET, resourceType: 'page', revisionNumber: 0 },
      { ...ASSET, resourceType: 'page', revisionNumber: NON_INTEGER_REVISION },
      { ...ASSET, resourceType: 'unknown' },
      { ...ASSET, action: 'execute' },
    ]) {
      expect((await request({ path: '/approvals', body })).status).toBe(StatusMap['Bad Request']);
    }
    expect(await database`select "id" from "publication_approval"`).toHaveLength(0);
    const overrides = {
      ownerId: 'owner-b',
      sessionId: 'foreign',
      expectedState: 'replacement',
      now: LATER,
    };
    const approval = await begin({ ...ASSET, ...overrides });
    const response = await request({
      path: `/approvals/${approval.approvalId}/complete`,
      body: {
        assertion: sign(approval),
        ...overrides,
        action: 'unpublish',
        resourceType: 'entity',
        readableId: 'secondary',
        revisionNumber: 2,
      },
    });
    expect(response.status).toBe(StatusMap.OK);
    expect(await response.json()).toMatchObject({
      state: 'changed',
      publication: { publishedAt: NOW },
    });
    expect(
      await publications.assetStatus({ ownerId: 'owner-a', readableId: 'primary' }),
    ).toMatchObject({ publishedAt: NOW });
    expect(
      await publications.assetStatus({ ownerId: 'owner-b', readableId: 'primary' }),
    ).toMatchObject({ publishedAt: null });
    expect(
      await publications.entityStatus({ ownerId: 'owner-a', readableId: 'secondary' }),
    ).toMatchObject({ publishedAt: null });
  });
});

test('private dependencies return detailed typed blockers without creating an approval', async () => {
  await withController(async ({ database, request }) => {
    await database`insert into "knowledge_page_entity_mention" ("source_revision_id", "target_entity_id", "owner_id") values ('owner-a-page-primary-revision', 'owner-a-entity-primary', 'owner-a')`;
    const response = await request({
      path: '/approvals',
      body: {
        ...ASSET,
        resourceType: 'page',
        revisionNumber: 1,
      },
    });
    expect(response.status).toBe(StatusMap.Conflict);
    expect(await response.json()).toEqual({
      state: 'blocked',
      error: expect.any(String),
      blockers: [
        {
          reason: 'reference_not_public',
          resource: { resourceType: 'entity', readableId: 'primary', name: 'Entity' },
        },
      ],
    });
    expect(await database`select "id" from "publication_approval"`).toHaveLength(0);
  });
});

test('changed reviewed state and new public inbound dependencies are typed conflicts at completion', async () => {
  await withController(async ({ database, begin, complete, request }) => {
    const stale = await begin();
    await database`update "asset" set "name" = 'Changed' where "id" = 'owner-a-asset-primary'`;
    const response = await complete(stale);
    expect(response.status).toBe(StatusMap.Conflict);
    expect(await response.json()).toMatchObject({ state: 'state_changed' });
    expect(await (await request({ path: '/asset/primary' })).json()).toMatchObject({
      publishedAt: null,
    });
    expect((await complete(stale)).status).toBe(StatusMap.Conflict);
    expect((await complete(await begin())).status).toBe(StatusMap.OK);
    const withdrawal = await begin({ ...ASSET, action: 'unpublish' });
    await database`update "entity" set "image_asset_id" = 'owner-a-asset-primary' where "id" = 'owner-a-entity-primary'`;
    expect((await complete(await begin({ ...ASSET, resourceType: 'entity' }))).status).toBe(
      StatusMap.OK,
    );
    const blocked = await complete(withdrawal);
    expect(blocked.status).toBe(StatusMap.Conflict);
    expect(await blocked.json()).toMatchObject({
      state: 'blocked',
      blockers: [
        {
          reason: 'public_entity_image',
          resource: { resourceType: 'entity', readableId: 'primary', name: 'Entity' },
        },
      ],
    });
    expect(await (await request({ path: '/asset/primary' })).json()).toMatchObject({
      publishedAt: NOW,
    });
  });
});

test('missing passkey, expired approval and missing user verification cannot authorize publication', async () => {
  await withController(async ({ database, begin, request, passkey, setTime }) => {
    const approval = await begin();
    const path = `/approvals/${approval.approvalId}/complete`;
    const assertion = passkey.authentication({
      origin: ORIGIN,
      challenge: approval.options.challenge,
      flags: USER_PRESENT,
    });
    const invalid = await request({ path, body: { assertion } });
    expect(invalid.status).toBe(StatusMap.Forbidden);
    expect(await invalid.json()).toMatchObject({ state: 'assertion_invalid' });
    setTime(approval.expiresAt);
    expect(await (await request({ path, body: { assertion } })).json()).toMatchObject({
      state: 'approval_invalid',
    });
    await database`delete from "auth_passkey" where "userId" = 'owner-a'`;
    const missing = await request({ path: '/approvals', body: ASSET });
    expect(missing.status).toBe(StatusMap.Conflict);
    expect(await missing.json()).toMatchObject({ state: 'passkey_required' });
    expect(await (await request({ path: '/asset/primary' })).json()).toMatchObject({
      publishedAt: null,
    });
  });
});

test('transaction failures use the normal HTTP error response and preserve approval for safe retry', async () => {
  await withController(async ({ database, begin, request, sign }) => {
    const approval = await begin();
    const path = `/approvals/${approval.approvalId}/complete`;
    const assertion = sign(approval);
    await database.unsafe(
      `create trigger fail_publication before update of "published_at" on "asset" begin select raise(abort, 'publication failed'); end`,
    );
    const failed = await request({ path, body: { assertion } });
    expect(failed.status).toBe(StatusMap['Internal Server Error']);
    expect(await failed.json()).toEqual({ error: 'Internal server error' });
    expect(await (await request({ path: '/asset/primary' })).json()).toMatchObject({
      publishedAt: null,
    });
    expect(await database`select "id" from "publication_approval"`).toHaveLength(1);
    await database.unsafe('drop trigger fail_publication');
    expect((await request({ path, body: { assertion } })).status).toBe(StatusMap.OK);
    expect(await (await request({ path: '/asset/primary' })).json()).toMatchObject({
      publishedAt: NOW,
    });
  });
});

test('records use owner passkey approval and stale content cannot be published', () =>
  withController(async ({ database, begin, complete, request }) => {
    await database`
    insert into "record" ("owner_id", "readable_id", "provider", "kind", "source_id", "title", "storage_key", "content_hash", "size_bytes", "created_at", "updated_at")
    values ('owner-a', 'record', 'test', 'note', 'source', 'Record', 'record-key', ${HASH}, 1, ${NOW}, ${NOW})
  `;
    const target = { resourceType: 'record', readableId: 'record', action: 'publish' };
    const stale = await begin(target);
    await database`update "record" set "title" = 'Changed record' where "owner_id" = 'owner-a' and "readable_id" = 'record'`;
    expect(await (await complete(stale)).json()).toMatchObject({ state: 'state_changed' });
    expect(await (await request({ path: '/record/record' })).json()).toEqual({
      resourceType: 'record',
      publicId: null,
      publishedAt: null,
    });
    const approval = await begin(target);
    expect(approval.preparation.resource.name).toBe('Changed record');
    expect((await complete(approval)).status).toBe(StatusMap.OK);
    expect((await complete(approval)).status).toBe(StatusMap.Conflict);
    const published = await (await request({ path: '/record/record' })).json();
    expect(published).toMatchObject({
      resourceType: 'record',
      publishedAt: NOW,
      publicId: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      ),
    });
    expect((await complete(await begin({ ...target, action: 'unpublish' }))).status).toBe(
      StatusMap.OK,
    );
    expect(await (await request({ path: '/record/record' })).json()).toEqual({
      ...published,
      publishedAt: null,
    });
  }));
