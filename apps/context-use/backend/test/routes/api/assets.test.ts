import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StatusMap } from 'elysia';
import { createApp } from '#backend/app.ts';
import { createSqliteDatabase } from '#backend/db/client.ts';
import { runMigrations } from '#backend/db/migrate.ts';
import type { Auth } from '#backend/lib/auth/better-auth.ts';
import { OWNER_SYNTHETIC_EMAIL, OWNER_USER_ID } from '#backend/lib/auth/owner-registration.ts';
import { LocalStorage } from '#backend/lib/storage/local-storage.ts';
import { AssetsRepository } from '#backend/repositories/assets/repository.ts';
import { EntitiesRepository } from '#backend/repositories/entities/repository.ts';
import { HealthRepository } from '#backend/repositories/health/repository.ts';
import { KnowledgePagesRepository } from '#backend/repositories/knowledge-pages/repository.ts';
import { KnowledgeProfilesRepository } from '#backend/repositories/knowledge-profiles/repository.ts';
import { OwnerRegistrationRepository } from '#backend/repositories/owner-registration/repository.ts';
import { AssetsService } from '#backend/services/assets/service.ts';
import { EntitiesService } from '#backend/services/entities/service.ts';
import type { FrontendAssetsServiceContract } from '#backend/services/frontend-assets/service.ts';
import { HealthService } from '#backend/services/health/service.ts';
import { KnowledgePagesService } from '#backend/services/knowledge-pages/service.ts';
import { KnowledgeProfilesService } from '#backend/services/knowledge-profiles/service.ts';
import { OwnerRegistrationService } from '#backend/services/owner-registration/service.ts';
import {
  unusedApiKeysService,
  unusedAssetFacesService,
  unusedHistoryService,
  unusedManagedSyncsService,
  unusedPublicationApprovalService,
  unusedPublicResourcesService,
  unusedPublicSiteService,
  unusedRecordsService,
  unusedSyncFetch,
} from '../../support/app.ts';
import { createTestHypermediaRetrievalService } from '../../support/hypermedia-retrieval.ts';
import {
  testMcpServerUrl,
  unusedAssetTransferCapabilities,
  unusedMcpClientAuthorizationsService,
  unusedMcpProtection,
  unusedMcpTransport,
} from '../../support/mcp.ts';
import { expectNoInternalResourceIds } from '../../support/public-api.ts';

const SHA256_HEX_LENGTH = 64;
const RANGE_CHUNK_BYTES = 8;
const EXPECTED_ASSET_BLOCKER_COUNT = 3;

const frontendAssetsService: FrontendAssetsServiceContract = {
  routes: () => new Map(),
  fallback: () => null,
};

function ownerAuth(): Auth {
  const createdAt = new Date('2026-01-01T00:00:00.000Z');
  return {
    passkeyOrigins: [],
    handler: async () => new Response(null, { status: StatusMap['Not Found'] }),
    getSession: async () => ({
      user: {
        id: OWNER_USER_ID,
        name: 'Owner',
        email: OWNER_SYNTHETIC_EMAIL,
        emailVerified: true,
        createdAt,
        updatedAt: createdAt,
      },
      session: {
        id: 'session-id',
        userId: OWNER_USER_ID,
        token: 'session-token',
        expiresAt: new Date('2027-01-01T00:00:00.000Z'),
        createdAt,
        updatedAt: createdAt,
      },
    }),
    protectMcpRequest: unusedMcpProtection,
  };
}

function jsonRequest({ method, path, body }: { method: string; path: string; body?: unknown }) {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    body = { changeMessage: 'Updated test context', ...(body as object | undefined) };
  }
  return new Request(`http://localhost/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body:
      body === undefined
        ? undefined
        : JSON.stringify({ changeMessage: 'Updated test context', ...(body as object) }),
  });
}

async function withAssetsApp(
  run: (fixture: {
    app: ReturnType<typeof createApp>;
    database: Awaited<ReturnType<typeof createSqliteDatabase>>;
    storage: LocalStorage;
    timestamp: string;
    auth: Auth;
  }) => Promise<void>,
) {
  const dataFolder = await mkdtemp(join(tmpdir(), 'context-use-assets-test-'));
  const database = await createSqliteDatabase({ dataFolder });
  try {
    await runMigrations({ db: database });
    const timestamp = '2026-01-01T00:00:00.000Z';
    await database`
      insert into "auth_user"
        ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
      values (${OWNER_USER_ID}, 'Owner', ${OWNER_SYNTHETIC_EMAIL}, 1, ${timestamp}, ${timestamp})
    `;
    const storage = new LocalStorage(join(dataFolder, 'objects'));
    const assetsRepository = new AssetsRepository(database);
    const pagesRepository = new KnowledgePagesRepository(database);
    const retrieval = createTestHypermediaRetrievalService({
      database,
      storage: new LocalStorage(join(dataFolder, 'objects')),
    });
    const auth = ownerAuth();
    const app = createApp({
      publicOwnerId: 'owner-a',
      publicSiteService: unusedPublicSiteService,
      publicationApprovalService: unusedPublicationApprovalService,
      publicResourcesService: unusedPublicResourcesService,
      historyService: unusedHistoryService,
      managedSyncsService: unusedManagedSyncsService,
      syncFetch: unusedSyncFetch,
      retrievalService: retrieval,
      auth,
      assetsService: new AssetsService({
        faces: unusedAssetFacesService,
        assets: assetsRepository,
        storage,
      }),
      assetTransferCapabilities: unusedAssetTransferCapabilities,
      frontendAssetsService,
      entitiesService: new EntitiesService({
        assets: assetsRepository,
        onPersonPortraitAvailable: unusedAssetFacesService.preparePortrait,
        entities: new EntitiesRepository(database),
        pages: pagesRepository,
      }),
      healthService: new HealthService(new HealthRepository(database)),
      mcpClientAuthorizationsService: unusedMcpClientAuthorizationsService,
      mcpServerUrl: testMcpServerUrl,
      mcpTransport: unusedMcpTransport,
      ownerRegistrationService: new OwnerRegistrationService(
        new OwnerRegistrationRepository(database),
      ),
      pagesService: new KnowledgePagesService({ pages: pagesRepository, storage }),
      profilesService: new KnowledgeProfilesService(new KnowledgeProfilesRepository(database)),
      recordsService: unusedRecordsService,
      apiKeysService: unusedApiKeysService,
    });

    await run({ app, database, storage, timestamp, auth });
  } finally {
    await database.close();
    await rm(dataFolder, { recursive: true, force: true });
  }
}

async function uploadChart(app: ReturnType<typeof createApp>) {
  const pngBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6Z5sAAAAASUVORK5CYII=',
    'base64',
  );
  const form = new FormData();
  form.set('changeMessage', 'Added test asset');
  form.set('name', 'Quarterly chart');
  form.set('file', new File([pngBytes], 'misleading.html', { type: 'text/html' }));
  const uploadResponse = await app.handle(
    new Request('http://localhost/api/assets', { method: 'POST', body: form }),
  );
  return { pngBytes, uploadResponse };
}

test('assets are server-inspected, linked or assigned, and archived only when unused', async () => {
  await withAssetsApp(async ({ app, database, storage, timestamp }) => {
    const { pngBytes, uploadResponse } = await uploadChart(app);
    expect(uploadResponse.status).toBe(StatusMap.Created);
    expectNoInternalResourceIds(await uploadResponse.clone().json());
    expect(await uploadResponse.json()).toEqual(
      expect.objectContaining({
        readableId: 'quarterly-chart',
        name: 'Quarterly chart',
        mediaType: 'image/png',
        extension: 'png',
        sizeBytes: pngBytes.byteLength,
        usages: [],
      }),
    );

    const contentResponse = await app.handle(
      new Request('http://localhost/api/assets/quarterly-chart/content'),
    );
    expect(contentResponse.status).toBe(StatusMap.OK);
    expect(contentResponse.headers.get('content-type')).toBe('image/png');
    expect(contentResponse.headers.get('content-disposition')).toStartWith('inline;');
    expect(new Uint8Array(await contentResponse.arrayBuffer())).toEqual(pngBytes);

    const downloadResponse = await app.handle(
      new Request('http://localhost/api/assets/quarterly-chart/content?download=true'),
    );
    expect(downloadResponse.status).toBe(StatusMap.OK);
    expect(downloadResponse.headers.get('content-disposition')).toStartWith('attachment;');

    const pdfBytes = Buffer.from('%PDF-1.7\nasset preview');
    const pdfForm = new FormData();
    pdfForm.set('changeMessage', 'Added test asset');
    pdfForm.set('name', 'Investment memo');
    pdfForm.set('file', new File([pdfBytes], 'investment-memo.pdf'));
    expect(
      (
        await app.handle(
          new Request('http://localhost/api/assets', { method: 'POST', body: pdfForm }),
        )
      ).status,
    ).toBe(StatusMap.Created);

    const pdfContentResponse = await app.handle(
      new Request('http://localhost/api/assets/investment-memo/content'),
    );
    expect(pdfContentResponse.headers.get('content-type')).toBe('application/pdf');
    expect(pdfContentResponse.headers.get('content-disposition')).toStartWith('inline;');

    const mp4Bytes = Buffer.from('00000018667479706d703432000000006d70343169736f6d', 'hex');
    const mp4Form = new FormData();
    mp4Form.set('changeMessage', 'Added test asset');
    mp4Form.set('name', 'Factory recording');
    mp4Form.set('file', new File([mp4Bytes], 'misleading.bin'));
    const mp4UploadResponse = await app.handle(
      new Request('http://localhost/api/assets', { method: 'POST', body: mp4Form }),
    );
    expect(mp4UploadResponse.status).toBe(StatusMap.Created);
    expect(await mp4UploadResponse.json()).toEqual(
      expect.objectContaining({
        readableId: 'factory-recording',
        mediaType: 'video/mp4',
        extension: 'mp4',
      }),
    );
    const mp4ContentResponse = await app.handle(
      new Request('http://localhost/api/assets/factory-recording/content'),
    );
    expect(mp4ContentResponse.headers.get('content-type')).toBe('video/mp4');
    expect(mp4ContentResponse.headers.get('content-disposition')).toStartWith('inline;');

    const entityResponse = await app.handle(
      jsonRequest({
        method: 'POST',
        path: '/entities',
        body: { name: 'Luca Bianchi', description: 'Researcher and collaborator' },
      }),
    );
    expect(entityResponse.status).toBe(StatusMap.Created);

    await database`
      insert into "auth_user"
        ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
      values ('other-owner', 'Other owner', 'other@example.com', 1, ${timestamp}, ${timestamp})
    `;
    await database`
      insert into "asset"
        ("id", "owner_id", "readable_id", "name", "media_type", "extension", "size_bytes",
         "content_hash", "storage_key", "created_at", "updated_at")
      values
        ('other-portrait-id', 'other-owner', 'other-portrait', 'Other portrait', 'image/png',
         'png', 1, ${'a'.repeat(SHA256_HEX_LENGTH)},
         'other-owner/assets/other-portrait/content.png', ${timestamp}, ${timestamp})
    `;
    const crossOwnerImageResponse = await app.handle(
      jsonRequest({
        method: 'PUT',
        path: '/entities/luca-bianchi/image',
        body: { assetReadableId: 'other-portrait' },
      }),
    );
    expect(crossOwnerImageResponse.status).toBe(StatusMap['Not Found']);

    const imageAssetsResponse = await app.handle(
      new Request('http://localhost/api/assets?kind=entity_image&query='),
    );
    expect(imageAssetsResponse.status).toBe(StatusMap.OK);
    expectNoInternalResourceIds(await imageAssetsResponse.clone().json());
    expect((await imageAssetsResponse.json()) as { items: Array<{ readableId: string }> }).toEqual(
      expect.objectContaining({
        items: [expect.objectContaining({ readableId: 'quarterly-chart' })],
      }),
    );

    const invalidImageResponse = await app.handle(
      jsonRequest({
        method: 'PUT',
        path: '/entities/luca-bianchi/image',
        body: { assetReadableId: 'investment-memo' },
      }),
    );
    expect(invalidImageResponse.status).toBe(StatusMap['Bad Request']);

    await database`
      update "entity" set "public_id" = '0e21c289-29c5-4f4b-bf66-1026c6a988c2', "published_at" = ${timestamp}
      where "owner_id" = ${OWNER_USER_ID} and "readable_id" = 'luca-bianchi'
    `;
    const privateImageResponse = await app.handle(
      jsonRequest({
        method: 'PUT',
        path: '/entities/luca-bianchi/image',
        body: { assetReadableId: 'quarterly-chart' },
      }),
    );
    expect(privateImageResponse.status).toBe(StatusMap.Conflict);
    expect(await privateImageResponse.json()).toEqual({
      error: 'Publish this image asset before assigning it to a public entity.',
    });
    expect(
      await database<Array<{ imageAssetId: string | null }>>`
      select "image_asset_id" as "imageAssetId" from "entity"
      where "owner_id" = ${OWNER_USER_ID} and "readable_id" = 'luca-bianchi'
    `,
    ).toEqual([{ imageAssetId: null }]);
    await database`
      update "asset" set "public_id" = '410550a2-b79c-4178-aa58-d23cb19d8e47', "published_at" = ${timestamp}
      where "owner_id" = ${OWNER_USER_ID} and "readable_id" = 'quarterly-chart'
    `;

    const publicAssets = await app.handle(
      jsonRequest({ method: 'GET', path: '/assets?visibility=public' }),
    );
    expect(publicAssets.status).toBe(StatusMap.OK);
    expect(await publicAssets.json()).toMatchObject({
      items: [{ readableId: 'quarterly-chart' }],
      total: 1,
    });
    expect(
      (await app.handle(jsonRequest({ method: 'GET', path: '/assets?visibility=published' })))
        .status,
    ).toBe(StatusMap['Bad Request']);

    const assignImageResponse = await app.handle(
      jsonRequest({
        method: 'PUT',
        path: '/entities/luca-bianchi/image',
        body: { assetReadableId: 'quarterly-chart' },
      }),
    );
    expect(assignImageResponse.status).toBe(StatusMap.OK);
    expectNoInternalResourceIds(await assignImageResponse.clone().json());
    expect(await assignImageResponse.json()).toEqual(
      expect.objectContaining({
        readableId: 'luca-bianchi',
        image: expect.objectContaining({ readableId: 'quarterly-chart', mediaType: 'image/png' }),
      }),
    );

    await database`
      update "entity" set "published_at" = null where "owner_id" = ${OWNER_USER_ID}
    `;
    await database`
      update "asset" set "published_at" = null where "owner_id" = ${OWNER_USER_ID}
    `;

    const entityDetailResponse = await app.handle(
      new Request('http://localhost/api/entities/luca-bianchi'),
    );
    expect(entityDetailResponse.status).toBe(StatusMap.OK);
    expectNoInternalResourceIds(await entityDetailResponse.clone().json());
    expect(await entityDetailResponse.json()).toEqual(
      expect.objectContaining({
        image: expect.objectContaining({ readableId: 'quarterly-chart' }),
      }),
    );

    const entitiesResponse = await app.handle(new Request('http://localhost/api/entities'));
    expect(entitiesResponse.status).toBe(StatusMap.OK);
    expectNoInternalResourceIds(await entitiesResponse.clone().json());
    expect((await entitiesResponse.json()) as { items: unknown[] }).toEqual(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            readableId: 'luca-bianchi',
            image: expect.objectContaining({ readableId: 'quarterly-chart' }),
          }),
        ],
      }),
    );

    const secondEntityResponse = await app.handle(
      jsonRequest({
        method: 'POST',
        path: '/entities',
        body: { name: 'Maya Chen', description: 'Product designer and researcher' },
      }),
    );
    expect(secondEntityResponse.status).toBe(StatusMap.Created);
    const duplicateImageResponse = await app.handle(
      jsonRequest({
        method: 'PUT',
        path: '/entities/maya-chen/image',
        body: { assetReadableId: 'quarterly-chart' },
      }),
    );
    expect(duplicateImageResponse.status).toBe(StatusMap.Conflict);

    const availableImageAssetsResponse = await app.handle(
      new Request('http://localhost/api/assets?kind=entity_image&query='),
    );
    expect(availableImageAssetsResponse.status).toBe(StatusMap.OK);
    expect((await availableImageAssetsResponse.json()) as { items: unknown[] }).toEqual(
      expect.objectContaining({ items: [] }),
    );

    const pageResponse = await app.handle(
      jsonRequest({
        method: 'POST',
        path: '/pages',
        body: {
          markdown: `# Evidence report\n\n![Quarterly chart](context-use://asset/quarterly-chart)\n\n[Download chart](context-use://asset/quarterly-chart)\n\n[Investment memo](context-use://asset/investment-memo)\n\n[Luca Bianchi](context-use://entity/luca-bianchi) reviewed the evidence.`,
        },
      }),
    );
    expect(pageResponse.status).toBe(StatusMap.Created);
    const page = (await pageResponse.json()) as {
      readableId: string;
      revisionNumber: number;
      mentions: Array<{ image: { readableId: string } | null }>;
    };
    expectNoInternalResourceIds(page);
    expect(page.mentions[0]?.image?.readableId).toBe('quarterly-chart');

    const detailResponse = await app.handle(
      new Request('http://localhost/api/assets/quarterly-chart'),
    );
    expect(detailResponse.status).toBe(StatusMap.OK);
    const detail = (await detailResponse.json()) as {
      usages: Array<{ kind: string; presentation?: string; entity?: { readableId: string } }>;
    };
    expectNoInternalResourceIds(detail);
    expect(detail.usages).toEqual([
      expect.objectContaining({ kind: 'page', presentation: 'attachment' }),
      expect.objectContaining({ kind: 'page', presentation: 'embed' }),
      expect.objectContaining({
        kind: 'entity_image',
        entity: expect.objectContaining({ readableId: 'luca-bianchi' }),
      }),
    ]);
    const previewDetailResponse = await app.handle(
      new Request('http://localhost/api/assets/quarterly-chart/preview'),
    );
    expect(previewDetailResponse.status).toBe(StatusMap.OK);
    expect(await previewDetailResponse.json()).toEqual({
      archivedAt: null,
      readableId: 'quarterly-chart',
      name: 'Quarterly chart',
      mediaType: 'image/png',
      extension: 'png',
      sizeBytes: pngBytes.byteLength,
    });
    const entityPreviewResponse = await app.handle(
      new Request('http://localhost/api/entities/luca-bianchi/preview'),
    );
    expect(await entityPreviewResponse.json()).toMatchObject({
      image: { readableId: 'quarterly-chart' },
    });

    const blockedResponse = await app.handle(
      jsonRequest({ method: 'PUT', path: '/assets/quarterly-chart/archive' }),
    );
    expect(blockedResponse.status).toBe(StatusMap.Conflict);
    const conflict = (await blockedResponse.json()) as { blockers: unknown[] };
    expectNoInternalResourceIds(conflict);
    expect(conflict.blockers).toHaveLength(EXPECTED_ASSET_BLOCKER_COUNT);

    const updateResponse = await app.handle(
      jsonRequest({
        method: 'PUT',
        path: `/pages/${page.readableId}`,
        body: {
          expectedRevisionNumber: page.revisionNumber,
          markdown:
            '# Evidence report\n\nThe chart was removed before archiving the asset. Keep the [memo](context-use://asset/investment-memo).',
        },
      }),
    );
    expect(updateResponse.status).toBe(StatusMap.OK);

    const entityBlockedResponse = await app.handle(
      jsonRequest({ method: 'PUT', path: '/assets/quarterly-chart/archive' }),
    );
    expect(entityBlockedResponse.status).toBe(StatusMap.Conflict);
    expectNoInternalResourceIds(await entityBlockedResponse.clone().json());
    expect((await entityBlockedResponse.json()) as { blockers: unknown[] }).toEqual(
      expect.objectContaining({
        blockers: [
          expect.objectContaining({
            kind: 'entity_image',
            entity: expect.objectContaining({ readableId: 'luca-bianchi' }),
          }),
        ],
      }),
    );

    const removeImageResponse = await app.handle(
      jsonRequest({ method: 'DELETE', path: '/entities/luca-bianchi/image' }),
    );
    expect(removeImageResponse.status).toBe(StatusMap.OK);
    expect(await removeImageResponse.json()).toEqual(
      expect.objectContaining({ readableId: 'luca-bianchi', image: null }),
    );

    const storedRows = await database<Array<{ storageKey: string }>>`
      select "storage_key" as "storageKey" from "asset"
      where "owner_id" = ${OWNER_USER_ID} and "readable_id" = 'quarterly-chart'
    `;
    await database`
      update "asset" set "published_at" = ${timestamp}
      where "owner_id" = ${OWNER_USER_ID} and "public_id" = '410550a2-b79c-4178-aa58-d23cb19d8e47'
    `;
    const publishedAssetArchive = await app.handle(
      jsonRequest({ method: 'PUT', path: '/assets/quarterly-chart/archive' }),
    );
    expect(publishedAssetArchive.status).toBe(StatusMap.Conflict);
    expect(await publishedAssetArchive.json()).toEqual({
      error: 'Unpublish this resource before archiving it.',
    });
    expect(
      await database<Array<{ archivedAt: string | null; publishedAt: string | null }>>`
      select asset."archived_at" as "archivedAt", asset."published_at" as "publishedAt"
      from "asset" asset
      where asset."owner_id" = ${OWNER_USER_ID} and asset."readable_id" = 'quarterly-chart'
    `,
    ).toEqual([{ archivedAt: null, publishedAt: timestamp }]);
    await database`
      update "asset" set "published_at" = null
      where "owner_id" = ${OWNER_USER_ID} and "public_id" = '410550a2-b79c-4178-aa58-d23cb19d8e47'
    `;
    const archiveResponse = await app.handle(
      jsonRequest({ method: 'PUT', path: '/assets/quarterly-chart/archive' }),
    );
    expect(archiveResponse.status).toBe(StatusMap['No Content']);
    expect(await storage.exists(storedRows[0]!.storageKey)).toBe(true);
    expect(
      (await app.handle(new Request('http://localhost/api/assets/quarterly-chart/preview'))).status,
    ).toBe(StatusMap['Not Found']);
    expect(
      (await app.handle(new Request('http://localhost/api/assets/quarterly-chart/content'))).status,
    ).toBe(StatusMap['Not Found']);
    expect(
      (await app.handle(jsonRequest({ method: 'PUT', path: `/pages/${page.readableId}/archive` })))
        .status,
    ).toBe(StatusMap['No Content']);
    const savedUsages = await database`
      select revision."revision_number" as "revisionNumber",
        asset."readable_id" as "assetReadableId", usage."presentation"
      from "knowledge_page_asset_usage" usage
      join "knowledge_page_revision" revision on revision."id" = usage."source_revision_id"
      join "asset" asset on asset."id" = usage."target_asset_id"
      where usage."owner_id" = ${OWNER_USER_ID}
      order by revision."revision_number", asset."readable_id", usage."presentation"
    `;
    expect(savedUsages).toEqual([
      { revisionNumber: 1, assetReadableId: 'investment-memo', presentation: 'attachment' },
      { revisionNumber: 1, assetReadableId: 'quarterly-chart', presentation: 'attachment' },
      { revisionNumber: 1, assetReadableId: 'quarterly-chart', presentation: 'embed' },
      { revisionNumber: 2, assetReadableId: 'investment-memo', presentation: 'attachment' },
    ]);
    const memoResponse = await app.handle(
      new Request('http://localhost/api/assets/investment-memo'),
    );
    expect(await memoResponse.json()).toMatchObject({ usages: [] });
    expect(
      (await app.handle(jsonRequest({ method: 'PUT', path: '/assets/investment-memo/archive' })))
        .status,
    ).toBe(StatusMap['No Content']);
  });
});

test('asset byte ranges stream exact portions and preserve full-response fallbacks over HTTP', async () => {
  await withAssetsApp(async ({ app }) => {
    const { pngBytes, uploadResponse } = await uploadChart(app);
    expect(uploadResponse.status).toBe(StatusMap.Created);

    const content = await app.handle(
      new Request('http://localhost/api/assets/quarterly-chart/content'),
    );
    const etag = content.headers.get('etag')!;
    await content.arrayBuffer();

    // Exercise the actual Bun transport as well as Elysia's request handler.
    const server = Bun.serve({ port: 0, fetch: app.handle });
    try {
      for (const [range, start, end] of [
        ['bytes=0-7', 0, RANGE_CHUNK_BYTES - 1],
        ['bytes=8-', RANGE_CHUNK_BYTES, pngBytes.length - 1],
        ['bytes=-8', pngBytes.length - RANGE_CHUNK_BYTES, pngBytes.length - 1],
        ['bytes=0-999999', 0, pngBytes.length - 1],
        ['bytes=-999999', 0, pngBytes.length - 1],
      ] as const) {
        const response = await fetch(new URL('/api/assets/quarterly-chart/content', server.url), {
          headers: { range },
        });
        expect(response.status).toBe(StatusMap['Partial Content']);
        expect(response.headers.get('accept-ranges')).toBe('bytes');
        expect(response.headers.get('content-range')).toBe(
          `bytes ${start}-${end}/${pngBytes.length}`,
        );
        expect(response.headers.get('content-length')).toBe(String(end - start + 1));
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(
          pngBytes.subarray(start, end + 1),
        );
      }
      const unsatisfiable = await app.handle(
        new Request('http://localhost/api/assets/quarterly-chart/content', {
          headers: { range: `bytes=${pngBytes.length}-` },
        }),
      );
      expect(unsatisfiable.status).toBe(StatusMap['Range Not Satisfiable']);
      expect(unsatisfiable.headers.get('content-range')).toBe(`bytes */${pngBytes.length}`);
      expect(await unsatisfiable.text()).toBe('');
      const fallbackHeaders: Record<string, string>[] = [
        { range: 'nonsense' },
        { range: 'items=0-2' },
        { range: 'bytes=0-2,5-7' },
        { range: 'bytes=0-2', 'if-range': '"old-version"' },
        { range: 'bytes=0-2', 'if-range': `W/${etag}` },
      ];
      for (const headers of fallbackHeaders) {
        const response = await fetch(new URL('/api/assets/quarterly-chart/content', server.url), {
          headers,
        });
        expect(response.status).toBe(StatusMap.OK);
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(pngBytes);
      }
      const missing = await app.handle(
        new Request('http://localhost/api/assets/unknown/content', {
          headers: { range: 'bytes=0-1' },
        }),
      );
      expect(missing.status).toBe(StatusMap['Not Found']);
      expect(missing.headers.has('content-range')).toBe(false);
    } finally {
      await server.stop(true);
    }
  });
});

test('asset caches revalidate metadata and authorization before returning bytes or 304', async () => {
  await withAssetsApp(async ({ app, auth }) => {
    const ownerSession = await auth.getSession({ headers: new Headers() });
    let currentSession = ownerSession;
    auth.getSession = async () => currentSession;

    const { pngBytes, uploadResponse } = await uploadChart(app);
    expect(uploadResponse.status).toBe(StatusMap.Created);
    const contentResponse = await app.handle(
      new Request('http://localhost/api/assets/quarterly-chart/content'),
    );
    expect(contentResponse.status).toBe(StatusMap.OK);
    await contentResponse.arrayBuffer();

    const etag = contentResponse.headers.get('etag')!;
    expect(etag).toMatch(/^"[a-f0-9]+"$/);
    expect(contentResponse.headers.get('cache-control')).toBe('private, no-cache');
    expect(contentResponse.headers.get('vary')).toBe('Cookie, Authorization');
    for (const match of [etag, `W/${etag}`, `"older", ${etag}`, '*']) {
      const cached = await app.handle(
        new Request('http://localhost/api/assets/quarterly-chart/content', {
          headers: {
            'if-none-match': match,
            'if-modified-since': 'Thu, 01 Jan 1970 00:00:00 GMT',
            range: 'bytes=0-7',
          },
        }),
      );
      expect(cached.status).toBe(StatusMap['Not Modified']);
      expect(cached.headers.get('etag')).toBe(etag);
      expect(cached.headers.get('cache-control')).toBe('private, no-cache');
      expect(await cached.text()).toBe('');
    }
    for (const session of [
      null,
      { ...ownerSession!, user: { ...ownerSession!.user, id: 'another-owner' } },
    ]) {
      currentSession = session;
      const denied = await app.handle(
        new Request('http://localhost/api/assets/quarterly-chart/content', {
          headers: { 'if-none-match': etag, range: 'bytes=0-7' },
        }),
      );
      expect(denied.status).toBe(StatusMap.Unauthorized);
      expect(denied.headers.has('etag')).toBe(false);
    }
    currentSession = ownerSession;
    const resumed = await app.handle(
      new Request('http://localhost/api/assets/quarterly-chart/content', {
        headers: { 'if-range': etag, range: 'bytes=0-7' },
      }),
    );
    expect(resumed.status).toBe(StatusMap['Partial Content']);
    expect(resumed.headers.get('etag')).toBe(etag);
    expect(new Uint8Array(await resumed.arrayBuffer())).toEqual(
      pngBytes.subarray(0, RANGE_CHUNK_BYTES),
    );
    const renamed = await app.handle(
      jsonRequest({
        method: 'PUT',
        path: '/assets/quarterly-chart',
        body: { name: 'Renamed chart' },
      }),
    );
    expect(renamed.status).toBe(StatusMap.OK);
    const changed = await app.handle(
      new Request('http://localhost/api/assets/quarterly-chart/content', {
        headers: { 'if-none-match': etag },
      }),
    );
    expect(changed.status).toBe(StatusMap.OK);
    expect(changed.headers.get('etag')).not.toBe(etag);
    expect(changed.headers.get('content-disposition')).toContain('Renamed_chart.png');
    await changed.arrayBuffer();
    const download = await app.handle(
      new Request('http://localhost/api/assets/quarterly-chart/content?download=true', {
        headers: { 'if-none-match': changed.headers.get('etag')! },
      }),
    );
    expect(download.status).toBe(StatusMap.OK);
    expect(download.headers.get('etag')).not.toBe(changed.headers.get('etag'));
    await download.arrayBuffer();

    const archived = await app.handle(
      jsonRequest({ method: 'PUT', path: '/assets/quarterly-chart/archive' }),
    );
    expect(archived.status).toBe(StatusMap['No Content']);
    const unavailable = await app.handle(
      new Request('http://localhost/api/assets/quarterly-chart/content', {
        headers: { 'if-none-match': changed.headers.get('etag')! },
      }),
    );
    expect(unavailable.status).toBe(StatusMap['Not Found']);
    expect(unavailable.headers.has('etag')).toBe(false);
    expect(unavailable.headers.get('cache-control')).toBe('private, no-store');
  });
});

test('owner archive browsing and unarchiving preserve content and require active dependencies', async () => {
  await withAssetsApp(async ({ app, database }) => {
    const request = ({ method, path, body }: { method: string; path: string; body?: unknown }) =>
      app.handle(jsonRequest({ method, path, body }));
    expect((await uploadChart(app)).uploadResponse.status).toBe(StatusMap.Created);
    expect(
      (
        await request({
          method: 'POST',
          path: '/entities',
          body: {
            name: 'Recovery friend',
            description: 'Keep this identity',
            entityType: 'person',
          },
        })
      ).status,
    ).toBe(StatusMap.Created);
    expect(
      (
        await request({
          method: 'PUT',
          path: '/entities/recovery-friend/image',
          body: {
            assetReadableId: 'quarterly-chart',
          },
        })
      ).status,
    ).toBe(StatusMap.OK);
    expect(
      (
        await request({
          method: 'POST',
          path: '/pages',
          body: { markdown: '# Recovery target\n\nPreserved target.' },
        })
      ).status,
    ).toBe(StatusMap.Created);
    const markdown =
      '# Recovery note\n\n[Friend](context-use://entity/recovery-friend) and [target](context-use://page/recovery-target).\n\n![Chart](context-use://asset/quarterly-chart)';
    expect(
      (
        await request({
          method: 'POST',
          path: '/pages',
          body: { markdown, temporalCoverage: '2026-01' },
        })
      ).status,
    ).toBe(StatusMap.Created);
    const resourceTypes = { pages: 'knowledge_page', entities: 'entity', assets: 'asset' } as const;
    const expectedCounts = { pages: 2, entities: 1, assets: 1 };
    const resources = [
      {
        collection: 'pages',
        id: 'recovery-note',
        search: 'recovery',
        repository: new KnowledgePagesRepository(database),
      },
      {
        collection: 'entities',
        id: 'recovery-friend',
        search: 'friend',
        repository: new EntitiesRepository(database),
      },
      {
        collection: 'pages',
        id: 'recovery-target',
        search: 'target',
        repository: new KnowledgePagesRepository(database),
      },
      {
        collection: 'assets',
        id: 'quarterly-chart',
        search: 'chart',
        repository: new AssetsRepository(database),
      },
    ] as const;
    for (const resource of resources) {
      expect(
        (await request({ method: 'PUT', path: `/${resource.collection}/${resource.id}/archive` }))
          .status,
      ).toBe(StatusMap['No Content']);
    }
    for (const { collection, id, search, repository } of resources) {
      expect((await request({ method: 'GET', path: `/${collection}/${id}` })).status).toBe(
        StatusMap['Not Found'],
      );
      const preview = await request({
        method: 'GET',
        path: `/${collection}/${id}/preview?includeArchived=true`,
      });
      expect(preview.status).toBe(StatusMap.OK);
      expect((await preview.json()).archivedAt).toBeString();
      const detail = await request({
        method: 'GET',
        path: `/${collection}/${id}?includeArchived=true`,
      });
      expect(detail.status).toBe(StatusMap.OK);
      expect((await detail.json()).publishedAt).toBeNull();
      const list = await request({ method: 'GET', path: `/${collection}?status=archived` });
      const body = await list.json();
      expect(body.items.some((item: { readableId: string }) => item.readableId === id)).toBe(true);
      expect(body.total).toBe(expectedCounts[collection]);
      const type = resourceTypes[collection];
      const activeSearch = await request({
        method: 'GET',
        path: `/hypermedia/search?query=${search}&resourceTypes=${type}`,
      });
      expect((await activeSearch.json()).results).toEqual([]);
      const archivedSearch = await request({
        method: 'GET',
        path: `/hypermedia/search?query=${search}&resourceTypes=${type}&status=archived`,
      });
      expect((await archivedSearch.json()).results.length).toBeGreaterThan(0);
      // Explicit archived reads and mutations must retain owner scoping.
      expect(
        await repository.find({ ownerId: 'foreign-owner', readableId: id, includeArchived: true }),
      ).toBeNull();
      const foreignAttempt = {
        ownerId: 'foreign-owner',
        readableId: id,
        change: { clientName: null, message: 'Must not restore' },
        unarchivedAt: new Date().toISOString(),
      };
      expect(await repository.unarchive(foreignAttempt)).toEqual({ state: 'not_found' });
      expect(
        (await request({ method: 'PUT', path: `/${collection}/missing-resource/unarchive` }))
          .status,
      ).toBe(StatusMap['Not Found']);
    }
    expect((await request({ method: 'GET', path: '/assets/quarterly-chart/content' })).status).toBe(
      StatusMap['Not Found'],
    );
    expect(
      (
        await request({
          method: 'GET',
          path: '/assets/quarterly-chart/content?includeArchived=true',
        })
      ).status,
    ).toBe(StatusMap.OK);
    const blockers = await request({ method: 'PUT', path: '/pages/recovery-note/unarchive' });
    expect(blockers.status).toBe(StatusMap.Conflict);
    expect(
      (await blockers.json()).blockers
        .map((item: { resourceType: string }) => item.resourceType)
        .sort(),
    ).toEqual(['asset', 'entity', 'page']);
    expect(
      (await request({ method: 'PUT', path: '/entities/recovery-friend/unarchive' })).status,
    ).toBe(StatusMap.Conflict);
    const stillArchived = await request({
      method: 'GET',
      path: '/pages/recovery-note?includeArchived=true',
    });
    expect((await stillArchived.json()).archivedAt).toBeString();
    for (const { collection, id } of [...resources].reverse()) {
      expect(
        (await request({ method: 'PUT', path: `/${collection}/${id}/unarchive` })).status,
      ).toBe(StatusMap['No Content']);
      expect(
        (await request({ method: 'PUT', path: `/${collection}/${id}/unarchive` })).status,
      ).toBe(StatusMap['No Content']);
      const restored = await request({ method: 'GET', path: `/${collection}/${id}` });
      expect(restored.status).toBe(StatusMap.OK);
      expect((await restored.json()).archivedAt).toBeNull();
    }
    const restored = await (await request({ method: 'GET', path: '/pages/recovery-note' })).json();
    expect(restored.markdown).toBe(markdown);
    expect(restored.revisionNumber).toBe(1);
    expect(restored.temporalCoverage).toBe('2026-01');
    expect(restored.mentions[0].readableId).toBe('recovery-friend');
    expect(restored.references[0].page.readableId).toBe('recovery-target');
    expect(restored.assetUsages[0].asset.readableId).toBe('quarterly-chart');
    const changes = await database<
      Array<{ action: string }>
    >`select "action" from "resource_change" where "action" = 'unarchived'`;
    expect(changes).toHaveLength(resources.length);
    const search = await request({
      method: 'GET',
      path: '/hypermedia/search?query=recovery&resourceTypes=knowledge_page',
    });
    expect((await search.json()).results).toHaveLength(2);
    expect(
      (await (await request({ method: 'GET', path: '/pages?status=archived' })).json()).total,
    ).toBe(0);
  });
});
