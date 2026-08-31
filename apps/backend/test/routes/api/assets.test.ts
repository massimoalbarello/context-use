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
  };
}

function jsonRequest({ method, path, body }: { method: string; path: string; body?: unknown }) {
  return new Request(`http://localhost/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test('assets are server-inspected, linked from current page Markdown, and archived only when unused', async () => {
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
    const pagesRepository = new KnowledgePagesRepository(database);
    const app = createApp({
      auth: ownerAuth(),
      assetsService: new AssetsService({ assets: new AssetsRepository(database), storage }),
      frontendAssetsService,
      entitiesService: new EntitiesService({
        entities: new EntitiesRepository(database),
        pages: pagesRepository,
      }),
      healthService: new HealthService(new HealthRepository(database)),
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

    const pageResponse = await app.handle(
      jsonRequest({
        method: 'POST',
        path: '/pages',
        body: {
          markdown: `# Evidence report\n\n![Quarterly chart](context-use://asset/quarterly-chart)\n\n[Download chart](context-use://asset/quarterly-chart)`,
        },
      }),
    );
    expect(pageResponse.status).toBe(StatusMap.Created);
    const page = (await pageResponse.json()) as { readableId: string; revisionNumber: number };

    const detailResponse = await app.handle(
      new Request('http://localhost/api/assets/quarterly-chart'),
    );
    expect(detailResponse.status).toBe(StatusMap.OK);
    const detail = (await detailResponse.json()) as {
      usages: Array<{ presentation: string }>;
    };
    expect(detail.usages).toEqual([
      expect.objectContaining({ presentation: 'attachment' }),
      expect.objectContaining({ presentation: 'embed' }),
    ]);

    const blockedResponse = await app.handle(
      jsonRequest({ method: 'PUT', path: '/assets/quarterly-chart/archive' }),
    );
    expect(blockedResponse.status).toBe(StatusMap.Conflict);
    const conflict = (await blockedResponse.json()) as { blockers: unknown[] };
    expect(conflict.blockers).toHaveLength(1);

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
