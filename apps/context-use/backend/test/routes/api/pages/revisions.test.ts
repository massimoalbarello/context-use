import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Elysia, StatusMap } from 'elysia';
import { createSqliteDatabase } from '#backend/db/client.ts';
import { runMigrations } from '#backend/db/migrate.ts';
import type { Auth } from '#backend/lib/auth/better-auth.ts';
import { elysiaErrorHandler } from '#backend/lib/errors.ts';
import { LocalStorage } from '#backend/lib/storage/local-storage.ts';
import {
  type KnowledgePageDiff,
  MAX_REVISION_DIFF_EDIT_LENGTH,
} from '#backend/models/knowledge-pages/diff.ts';
import { KnowledgePagesRepository } from '#backend/repositories/knowledge-pages/repository.ts';
import { PublicResourcesRepository } from '#backend/repositories/public-resources/repository.ts';
import { createPageReadableIdController } from '#backend/routes/api/pages/[pageReadableId]/controller.ts';
import { createPagePublicationPreviewController } from '#backend/routes/api/pages/[pageReadableId]/revisions/publication-preview/controller.ts';
import { KnowledgePagesService } from '#backend/services/knowledge-pages/service.ts';
import { PublicResourcesService } from '#backend/services/public-resources/service.ts';
import { unusedMcpProtection } from '../../../support/mcp.ts';

const OWNER_ID = 'diff-owner';
const OTHER_OWNER_ID = 'other-diff-owner';
const INITIAL = '# Notes\n\nAlpha\nUnchanged\n';
const LATEST = '# Final notes\n\nGamma\nUnchanged\n';
const LAST_REVISION = 3;
const NOW = new Date('2026-09-01T12:00:00.000Z');

async function setup() {
  const dataFolder = await mkdtemp(join(tmpdir(), 'context-use-diff-test-'));
  const database = await createSqliteDatabase({ dataFolder });
  const dispose = async () => {
    await database.close();
    await rm(dataFolder, { recursive: true, force: true });
  };
  try {
    await runMigrations({ db: database });
    for (const ownerId of [OWNER_ID, OTHER_OWNER_ID]) {
      await database`
        insert into "auth_user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
        values (${ownerId}, ${ownerId}, ${`${ownerId}@example.invalid`}, 1, ${NOW.toISOString()}, ${NOW.toISOString()})
      `;
    }
    const storage = new LocalStorage(join(dataFolder, 'objects'));
    const repository = new KnowledgePagesRepository(database);
    const service = new KnowledgePagesService({ pages: repository, storage });
    const auth: Auth = {
      passkeyOrigins: [],
      handler: () => Promise.resolve(new Response(null, { status: StatusMap['Not Found'] })),
      protectMcpRequest: unusedMcpProtection,
      getSession: ({ headers }) => {
        const id = headers.get('x-test-owner');
        return Promise.resolve(
          id
            ? {
                user: {
                  id,
                  name: id,
                  email: `${id}@example.invalid`,
                  emailVerified: true,
                  createdAt: NOW,
                  updatedAt: NOW,
                },
                session: {
                  id: 'session',
                  userId: id,
                  token: 'token',
                  expiresAt: NOW,
                  createdAt: NOW,
                  updatedAt: NOW,
                },
              }
            : null,
        );
      },
    };
    const app = new Elysia({ prefix: '/api' })
      .onError(elysiaErrorHandler)
      .use(createPageReadableIdController({ auth, pagesService: service }))
      .use(
        createPagePublicationPreviewController({
          auth,
          publicResourcesService: new PublicResourcesService({
            resources: new PublicResourcesRepository(database),
            storage,
          }),
        }),
      );
    const request = ({
      query,
      readableId = 'notes',
      ownerId = OWNER_ID,
    }: {
      query: string;
      readableId?: string;
      ownerId?: string | null;
    }) =>
      app.handle(
        new Request(`http://localhost/api/pages/${readableId}/diff?${query}`, {
          headers: ownerId ? { 'x-test-owner': ownerId } : {},
        }),
      );
    const revisionRequest = ({
      revisionNumber = '1',
      readableId = 'notes',
      ownerId = OWNER_ID,
    }: {
      revisionNumber?: string;
      readableId?: string;
      ownerId?: string | null;
    } = {}) =>
      app.handle(
        new Request(`http://localhost/api/pages/${readableId}/revisions/${revisionNumber}`, {
          headers: ownerId ? { 'x-test-owner': ownerId } : {},
        }),
      );
    const input = { ownerId: OWNER_ID, actor: { kind: 'owner' } as const };
    expect(
      (
        await service.create({
          message: 'Updated test knowledge',
          ...input,
          markdown: INITIAL,
        })
      ).state,
    ).toBe('saved');
    expect(
      (
        await service.update({
          message: 'Updated test knowledge',
          ...input,
          readableId: 'notes',
          expectedRevisionNumber: 1,
          markdown: '# Notes\n\nBeta\nUnchanged\n',
          temporalCoverage: '2025',
        })
      ).state,
    ).toBe('saved');
    expect(
      (
        await service.update({
          message: 'Updated test knowledge',
          ...input,
          readableId: 'notes',
          expectedRevisionNumber: 2,
          markdown: LATEST,
          temporalCoverage: '2026',
        })
      ).state,
    ).toBe('saved');
    const previewRequest = ({
      ownerId = OWNER_ID,
      readableId = 'notes',
      revisionNumber = '1',
    }: {
      ownerId?: string | null;
      readableId?: string;
      revisionNumber?: string;
    } = {}) =>
      app.handle(
        new Request(
          `http://localhost/api/pages/${readableId}/revisions/${revisionNumber}/publication-preview`,
          {
            headers: ownerId ? { 'x-test-owner': ownerId } : {},
          },
        ),
      );
    return {
      previewRequest,
      request,
      revisionRequest,
      service,
      repository,
      storage,
      database,
      dispose,
      input,
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}

test('the API compares exact historical revisions in either direction and an empty baseline', async () => {
  const context = await setup();
  try {
    const changes = await context.database`
      select "page_revision_number", "client_name" from "resource_change"
      where "owner_id" = ${OWNER_ID} and "resource_type" = 'page' and "readable_id" = 'notes'
      order by "sequence"
    `;
    expect(changes).toEqual([
      { page_revision_number: 1, client_name: null },
      { page_revision_number: 2, client_name: null },
      { page_revision_number: LAST_REVISION, client_name: null },
    ]);
    const response = await context.request({ query: 'from=1&to=3' });
    expect(response.status).toBe(StatusMap.OK);
    const diff: KnowledgePageDiff = await response.json();
    expect(diff).toEqual({
      from: 1,
      to: LAST_REVISION,
      additions: 2,
      deletions: 2,
      temporalCoverage: { from: null, to: '2026' },
      hunks: [
        {
          oldStart: 1,
          oldLines: 4,
          newStart: 1,
          newLines: 4,
          lines: ['-# Notes', '+# Final notes', ' ', '-Alpha', '+Gamma', ' Unchanged'],
        },
      ],
    });
    const reverse = await context.request({ query: 'from=3&to=1' });
    expect(reverse.status).toBe(StatusMap.OK);
    expect(await reverse.json()).toMatchObject({
      from: LAST_REVISION,
      to: 1,
      additions: 2,
      deletions: 2,
      temporalCoverage: { from: '2026', to: null },
      hunks: [{ lines: ['-# Final notes', '+# Notes', ' ', '-Gamma', '+Alpha', ' Unchanged'] }],
    });
    const historical = await context.request({ query: 'from=1&to=2' });
    expect(await historical.json()).toMatchObject({
      temporalCoverage: { from: null, to: '2025' },
      hunks: [{ lines: [' # Notes', ' ', '-Alpha', '+Beta', ' Unchanged'] }],
    });
    const identical = await context.request({ query: 'from=2&to=2' });
    expect(await identical.json()).toEqual({
      from: 2,
      to: 2,
      hunks: [],
      additions: 0,
      deletions: 0,
      temporalCoverage: null,
    });
    const initial = await context.request({ query: 'from=0&to=1' });
    expect(await initial.json()).toMatchObject({
      from: 0,
      to: 1,
      additions: 4,
      deletions: 0,
      hunks: [{ lines: ['+# Notes', '+', '+Alpha', '+Unchanged'] }],
    });
    await context.service.update({
      message: 'Updated test knowledge',
      ...context.input,
      readableId: 'notes',
      expectedRevisionNumber: LAST_REVISION,
      markdown: LATEST,
      temporalCoverage: null,
    });
    const metadataOnly = await context.request({ query: 'from=3&to=4' });
    expect(await metadataOnly.json()).toMatchObject({
      hunks: [],
      additions: 0,
      deletions: 0,
      temporalCoverage: { from: '2026', to: null },
    });
    await context.service.update({
      message: 'Updated test knowledge',
      ...context.input,
      readableId: 'notes',
      expectedRevisionNumber: LAST_REVISION + 1,
      markdown: LATEST + 'New line\n'.repeat(MAX_REVISION_DIFF_EDIT_LENGTH + 1),
    });
    const tooLarge = await context.request({ query: 'from=4&to=5' });
    expect(tooLarge.status).toBe(StatusMap['Unprocessable Content']);
    expect(await tooLarge.json()).toEqual({ error: 'This comparison is too large to display.' });
  } finally {
    await context.dispose();
  }
});

test('comparison enforces authentication, page ownership, revision bounds and archival', async () => {
  const context = await setup();
  try {
    expect((await context.request({ query: 'from=1&to=2', ownerId: null })).status).toBe(
      StatusMap.Unauthorized,
    );
    const missing = await context.request({ query: 'from=1&to=2', readableId: 'missing' });
    const foreign = await context.request({ query: 'from=1&to=2', ownerId: OTHER_OWNER_ID });
    expect(foreign.status).toBe(StatusMap['Not Found']);
    expect(await foreign.json()).toEqual(await missing.json());
    // Even a matching readable ID cannot borrow revisions from another owner.
    await context.service.create({
      message: 'Updated test knowledge',
      ownerId: OTHER_OWNER_ID,
      actor: { kind: 'owner' },
      markdown: '# Notes\n\nPrivate content',
    });
    expect((await context.request({ query: 'from=1&to=2', ownerId: OTHER_OWNER_ID })).status).toBe(
      StatusMap['Not Found'],
    );
    const own = await context.request({ query: 'from=0&to=1', ownerId: OTHER_OWNER_ID });
    expect(await own.json()).toMatchObject({
      hunks: [{ lines: expect.arrayContaining(['+Private content']) }],
    });
    for (const query of ['from=99&to=2', 'from=1&to=99', 'from=0&to=99']) {
      expect((await context.request({ query })).status).toBe(StatusMap['Not Found']);
    }
    for (const query of [
      'from=-1&to=1',
      'from=1&to=0',
      'from=1.5&to=2',
      'from=1&to=2.5',
      'from=no&to=2',
      'to=2',
      'from=1&to=9007199254740992',
    ]) {
      expect((await context.request({ query })).status).toBe(StatusMap['Bad Request']);
    }
    expect(
      (
        await context.service.archive({
          change: { clientName: null, message: 'Archived test page' },
          ownerId: OWNER_ID,
          readableId: 'notes',
        })
      ).state,
    ).toBe('archived');
    expect((await context.request({ query: 'from=0&to=1' })).status).toBe(StatusMap['Not Found']);
  } finally {
    await context.dispose();
  }
});

test('revision reads return exact saved content and coverage without exposing persistence metadata', async () => {
  const context = await setup();
  try {
    const first = await context.revisionRequest();
    expect(first.status).toBe(StatusMap.OK);
    expect(await first.json()).toEqual({
      revisionNumber: 1,
      markdown: INITIAL,
      temporalCoverage: null,
    });
    const second = await context.revisionRequest({ revisionNumber: '2' });
    expect(await second.json()).toEqual({
      revisionNumber: 2,
      markdown: '# Notes\n\nBeta\nUnchanged\n',
      temporalCoverage: '2025',
    });
    await context.service.update({
      message: 'Add a newer draft',
      ...context.input,
      readableId: 'notes',
      expectedRevisionNumber: LAST_REVISION,
      markdown: '# New draft\n\nNot the selected content.',
    });
    expect(await (await context.revisionRequest()).json()).toEqual({
      revisionNumber: 1,
      markdown: INITIAL,
      temporalCoverage: null,
    });
  } finally {
    await context.dispose();
  }
});

test('revision reads enforce authentication, ownership, valid numbers and archival', async () => {
  const context = await setup();
  try {
    expect((await context.revisionRequest({ ownerId: null })).status).toBe(StatusMap.Unauthorized);
    const missing = await context.revisionRequest({ readableId: 'missing' });
    const foreign = await context.revisionRequest({ ownerId: OTHER_OWNER_ID });
    expect(missing.status).toBe(StatusMap['Not Found']);
    expect(foreign.status).toBe(StatusMap['Not Found']);
    expect(await foreign.json()).toEqual(await missing.json());
    await context.service.create({
      message: 'Other owner notes',
      ownerId: OTHER_OWNER_ID,
      actor: { kind: 'owner' },
      markdown: '# Notes\n\nOther owner content.',
    });
    expect(await (await context.revisionRequest({ ownerId: OTHER_OWNER_ID })).json()).toMatchObject(
      { markdown: '# Notes\n\nOther owner content.' },
    );
    expect(
      (await context.revisionRequest({ ownerId: OTHER_OWNER_ID, revisionNumber: '2' })).status,
    ).toBe(StatusMap['Not Found']);
    expect((await context.revisionRequest({ revisionNumber: '99' })).status).toBe(
      StatusMap['Not Found'],
    );
    for (const revisionNumber of ['0', '-1', '1.5', 'no', '9007199254740992']) {
      expect((await context.revisionRequest({ revisionNumber })).status).toBe(
        StatusMap['Bad Request'],
      );
    }
    await context.service.archive({
      ownerId: OWNER_ID,
      readableId: 'notes',
      change: { clientName: null, message: 'Archive notes' },
    });
    expect((await context.revisionRequest()).status).toBe(StatusMap['Not Found']);
  } finally {
    await context.dispose();
  }
});

test('historical blobs must pass integrity verification before comparison or preview', async () => {
  const context = await setup();
  try {
    const [revision] = await context.repository.revisionsByNumber({
      ownerId: OWNER_ID,
      readableId: 'notes',
      revisionNumbers: [1],
    });
    await context.storage.write(
      revision!.storageKey,
      new Blob([INITIAL.replace('Alpha', 'Other')]),
    );
    expect((await context.request({ query: 'from=1&to=3' })).status).toBe(
      StatusMap['Internal Server Error'],
    );
    expect((await context.revisionRequest()).status).toBe(StatusMap['Internal Server Error']);
    await context.storage.delete(revision!.storageKey);
    expect((await context.revisionRequest()).status).toBe(StatusMap['Internal Server Error']);
    expect((await context.request({ query: 'from=1&to=3' })).status).toBe(
      StatusMap['Internal Server Error'],
    );
  } finally {
    await context.dispose();
  }
});

test('publication previews render only the authenticated owner’s selected revision and stay private', async () => {
  const context = await setup();
  try {
    const response = await context.previewRequest();
    expect(response.status).toBe(StatusMap.OK);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const preview = await response.json();
    expect(preview.revisionNumber).toBe(1);
    expect(preview.html).toContain('<h1>Notes</h1>');
    expect(preview.html).toContain('Alpha');
    expect(preview.html).not.toContain('Gamma');
    expect((await context.previewRequest({ ownerId: null })).status).toBe(StatusMap.Unauthorized);
    const foreign = await context.previewRequest({ ownerId: OTHER_OWNER_ID });
    const missing = await context.previewRequest({ readableId: 'missing' });
    expect(foreign.status).toBe(StatusMap['Not Found']);
    expect(await foreign.json()).toEqual(await missing.json());
    await context.service.create({
      message: 'Other owner',
      ownerId: OTHER_OWNER_ID,
      actor: { kind: 'owner' },
      markdown: '# Notes\n\nOther owner content',
    });
    expect(
      (await (await context.previewRequest({ ownerId: OTHER_OWNER_ID })).json()).html,
    ).toContain('Other owner content');
    expect(
      (await context.previewRequest({ ownerId: OTHER_OWNER_ID, revisionNumber: '2' })).status,
    ).toBe(StatusMap['Not Found']);
    for (const revisionNumber of ['0', '-1', '1.5', 'no']) {
      expect((await context.previewRequest({ revisionNumber })).status).toBe(
        StatusMap['Bad Request'],
      );
    }
    expect((await context.previewRequest({ revisionNumber: '99' })).status).toBe(
      StatusMap['Not Found'],
    );
    await context.service.archive({
      ownerId: OWNER_ID,
      readableId: 'notes',
      change: { clientName: null, message: 'Archive notes' },
    });
    expect((await context.previewRequest()).status).toBe(StatusMap['Not Found']);
  } finally {
    await context.dispose();
  }
});
