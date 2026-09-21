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
import { createPageReadableIdController } from '#backend/routes/api/pages/[pageReadableId]/controller.ts';
import { KnowledgePagesService } from '#backend/services/knowledge-pages/service.ts';
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
      .use(createPageReadableIdController({ auth, pagesService: service }));
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
    const input = { ownerId: OWNER_ID, actor: { kind: 'owner' } as const };
    expect((await service.create({ ...input, markdown: INITIAL })).state).toBe('saved');
    expect(
      (
        await service.update({
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
          ...input,
          readableId: 'notes',
          expectedRevisionNumber: 2,
          markdown: LATEST,
          temporalCoverage: '2026',
        })
      ).state,
    ).toBe('saved');
    return { request, service, repository, storage, dispose, input };
  } catch (error) {
    await dispose();
    throw error;
  }
}

test('the API compares exact historical revisions in either direction and an empty baseline', async () => {
  const context = await setup();
  try {
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
    expect((await context.service.archive({ ownerId: OWNER_ID, readableId: 'notes' })).state).toBe(
      'archived',
    );
    expect((await context.request({ query: 'from=0&to=1' })).status).toBe(StatusMap['Not Found']);
  } finally {
    await context.dispose();
  }
});

test('historical blobs must exist and pass integrity verification before comparison', async () => {
  const context = await setup();
  try {
    const [revision] = await context.repository.revisionsForComparison({
      ownerId: OWNER_ID,
      readableId: 'notes',
      from: 1,
      to: 1,
    });
    await context.storage.write(
      revision!.storageKey,
      new Blob([INITIAL.replace('Alpha', 'Other')]),
    );
    expect((await context.request({ query: 'from=1&to=3' })).status).toBe(
      StatusMap['Internal Server Error'],
    );
    await context.storage.delete(revision!.storageKey);
    expect((await context.request({ query: 'from=1&to=3' })).status).toBe(
      StatusMap['Internal Server Error'],
    );
  } finally {
    await context.dispose();
  }
});
