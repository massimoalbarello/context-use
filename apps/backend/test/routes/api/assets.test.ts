import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StatusMap } from 'elysia';
import { createApp } from '#app.ts';
import { createSqliteDatabase } from '#db/client.ts';
import { runMigrations } from '#db/migrate.ts';
import type { Auth } from '#lib/auth/better-auth.ts';
import { OWNER_SYNTHETIC_EMAIL, OWNER_USER_ID } from '#lib/auth/owner-registration.ts';
import { LocalStorage } from '#lib/storage/local-storage.ts';
import { AssetsRepository } from '#repositories/assets/repository.ts';
import { EntitiesRepository } from '#repositories/entities/repository.ts';
import { HealthRepository } from '#repositories/health/repository.ts';
import { KnowledgePagesRepository } from '#repositories/knowledge-pages/repository.ts';
import { KnowledgeProfilesRepository } from '#repositories/knowledge-profiles/repository.ts';
import { OwnerRegistrationRepository } from '#repositories/owner-registration/repository.ts';
import { AssetsService } from '#services/assets/service.ts';
import { EntitiesService } from '#services/entities/service.ts';
import type { FrontendAssetsServiceContract } from '#services/frontend-assets/service.ts';
import { HealthService } from '#services/health/service.ts';
import { KnowledgePagesService } from '#services/knowledge-pages/service.ts';
import { KnowledgeProfilesService } from '#services/knowledge-profiles/service.ts';
import { OwnerRegistrationService } from '#services/owner-registration/service.ts';
import {
  testMcpServerUrl,
  unusedAssetTransferCapabilities,
  unusedMcpClientAuthorizationsService,
  unusedMcpProtection,
  unusedMcpTransport,
} from '../../support/mcp.ts';
import { expectNoInternalResourceIds } from '../../support/public-api.ts';

const SHA256_HEX_LENGTH = 64;
const EXPECTED_ASSET_BLOCKER_COUNT = 3;

const frontendAssetsService: FrontendAssetsServiceContract = {
  routes: () => new Map(),
  fallback: () => null,
};

function ownerAuth(): Auth {
  const createdAt = new Date('2026-01-01T00:00:00.000Z');
  return {
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
  return new Request(`http://localhost/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test('assets are server-inspected, linked or assigned, and archived only when unused', async () => {
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
    const app = createApp({
      auth: ownerAuth(),
      assetsService: new AssetsService({ assets: assetsRepository, storage }),
      assetTransferCapabilities: unusedAssetTransferCapabilities,
      frontendAssetsService,
      entitiesService: new EntitiesService({
        assets: assetsRepository,
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
    });

    const pngBytes = Buffer.from('89504e470d0a1a0a00010203', 'hex');
    const form = new FormData();
    form.set('name', 'Quarterly chart');
    form.set('file', new File([pngBytes], 'misleading.html', { type: 'text/html' }));
    const uploadResponse = await app.handle(
      new Request('http://localhost/api/assets', { method: 'POST', body: form }),
    );
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
          markdown: `# Evidence report\n\n![Quarterly chart](context-use://asset/quarterly-chart)\n\n[Download chart](context-use://asset/quarterly-chart)\n\n[Luca Bianchi](context-use://entity/luca-bianchi) reviewed the evidence.`,
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

    const knowledgeMapResponse = await app.handle(
      new Request('http://localhost/api/knowledge-map'),
    );
    const knowledgeMap = (await knowledgeMapResponse.json()) as {
      pages: Array<{
        readableId: string;
        mentions: Array<{ readableId: string; image: { readableId: string } | null }>;
        assetUsages: Array<{
          asset: { readableId: string; mediaType: string };
          presentation: string;
        }>;
      }>;
    };
    expectNoInternalResourceIds(knowledgeMap);
    expect(knowledgeMap.pages).toEqual([
      expect.objectContaining({
        readableId: 'evidence-report',
        mentions: [
          expect.objectContaining({
            readableId: 'luca-bianchi',
            image: expect.objectContaining({ readableId: 'quarterly-chart' }),
          }),
        ],
        assetUsages: [
          expect.objectContaining({
            asset: expect.objectContaining({
              readableId: 'quarterly-chart',
              mediaType: 'image/png',
            }),
            presentation: 'attachment',
          }),
          expect.objectContaining({
            asset: expect.objectContaining({ readableId: 'quarterly-chart' }),
            presentation: 'embed',
          }),
        ],
      }),
    ]);

    const assetFilteredKnowledgeMapResponse = await app.handle(
      new Request('http://localhost/api/knowledge-map?query=Quarterly%20chart'),
    );
    expect(assetFilteredKnowledgeMapResponse.status).toBe(StatusMap.OK);
    expect(await assetFilteredKnowledgeMapResponse.json()).toEqual(
      expect.objectContaining({
        pages: [expect.objectContaining({ readableId: 'evidence-report' })],
        totalPages: 1,
      }),
    );

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
          markdown: '# Evidence report\n\nThe chart was removed before archiving the asset.',
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
    const archiveResponse = await app.handle(
      jsonRequest({ method: 'PUT', path: '/assets/quarterly-chart/archive' }),
    );
    expect(archiveResponse.status).toBe(StatusMap['No Content']);
    expect(await storage.exists(storedRows[0]!.storageKey)).toBe(true);
    expect(
      (await app.handle(new Request('http://localhost/api/assets/quarterly-chart/content'))).status,
    ).toBe(StatusMap['Not Found']);
  } finally {
    await database.close();
    await rm(dataFolder, { recursive: true, force: true });
  }
});
