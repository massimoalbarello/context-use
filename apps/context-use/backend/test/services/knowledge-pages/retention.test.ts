// biome-ignore-all lint/style/noMagicNumbers: Explicit revision numbers make retention windows and gaps observable.
import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSqliteDatabase } from '#backend/db/client.ts';
import { runMigrations } from '#backend/db/migrate.ts';
import { LocalStorage } from '#backend/lib/storage/local-storage.ts';
import { parseKnowledgePageMarkdown } from '#backend/models/knowledge-pages/markdown.ts';
import { KnowledgePagesRepository } from '#backend/repositories/knowledge-pages/repository.ts';
import { PublicationApprovalsRepository } from '#backend/repositories/publications/approvals.ts';
import { PublicationsRepository } from '#backend/repositories/publications/repository.ts';
import { KnowledgePagesService } from '#backend/services/knowledge-pages/service.ts';

const OWNER = 'owner-a';
const NOW = '2026-10-04T12:00:00.000Z';
const CUTOFF = '2026-10-03T12:00:00.000Z';
const OLD = '2026-10-01T12:00:00.000Z';
const EXPIRES = '2026-10-04T12:05:00.000Z';
const HISTORY_COUNT = 15;
const NEXT_REVISION = 16;

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'context-use-revision-retention-'));
  const db = await createSqliteDatabase({ dataFolder: directory });
  const dispose = async () => {
    await db.close();
    await rm(directory, { recursive: true, force: true });
  };
  try {
    await runMigrations({ db });
    for (const ownerId of [OWNER, 'owner-b']) {
      await db`
        insert into "auth_user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
        values (${ownerId}, 'Owner', ${`${ownerId}@example.invalid`}, 1, ${NOW}, ${NOW})
      `;
      await db`
        insert into "auth_session" ("id", "userId", "token", "expiresAt", "createdAt", "updatedAt")
        values (${ownerId}, ${ownerId}, ${ownerId}, '2030-01-01T00:00:00.000Z', ${NOW}, ${NOW})
      `;
    }
    const storage = new LocalStorage(join(directory, 'objects'));
    const pages = new KnowledgePagesRepository(db);
    const publications = new PublicationsRepository(db);
    const approvals = new PublicationApprovalsRepository(db);
    const service = new KnowledgePagesService({ pages, storage });
    const identity = { ownerId: OWNER, readableId: 'notes' };
    async function saveAt({
      now = NOW,
      ownerId = OWNER,
      title = 'Notes',
      markdown,
    }: {
      now?: string;
      ownerId?: string;
      title?: string;
      markdown?: string;
    } = {}) {
      const readableId = title.toLowerCase();
      const current = await pages.find({ ownerId, readableId });
      const pageId = current?.id ?? crypto.randomUUID();
      const revisionId = crypto.randomUUID();
      const content = markdown ?? `# ${title}\n\nVersion ${(current?.revisionNumber ?? 0) + 1}.\n`;
      const parsed = parseKnowledgePageMarkdown(content);
      const storageKey = `${ownerId}/pages/${pageId}/revisions/${revisionId}.md`;
      await storage.write(storageKey, new Blob([content]));
      const common = {
        ownerId,
        revisionId,
        readableId,
        title: parsed.title,
        excerpt: parsed.excerpt,
        searchableText: parsed.searchableText,
        temporalCoverage: null,
        links: parsed.links,
        storageKey,
        contentHash: new Bun.CryptoHasher('sha256').update(content).digest('hex'),
        sizeBytes: Buffer.byteLength(content),
        actor: { kind: 'owner' } as const,
        message: 'Save notes',
      };
      const result = current
        ? await pages.update({
            ...common,
            expectedRevisionNumber: current.revisionNumber,
            updatedAt: now,
          })
        : await pages.create({ ...common, pageId, createdAt: now });
      if (
        result.state !== 'created' &&
        result.state !== 'updated' &&
        result.state !== 'unchanged'
      ) {
        throw new Error(`Unexpected save: ${result.state}`);
      }
      return result.page;
    }
    const retained = async (input = identity) =>
      (await pages.detail(input))!.revisions.map((revision) => revision.revisionNumber);
    const pending = async ({ pageId, ownerId = OWNER }: { pageId: string; ownerId?: string }) =>
      pages.pendingRevisionBlobDeletions({ ownerId, pageId, afterStorageKey: '', limit: 100 });
    const publish = async (revisionNumber: number) => {
      const request = {
        ...identity,
        resourceType: 'page',
        action: 'publish',
        revisionNumber,
      } as const;
      const preparation = await publications.prepare(request);
      expect(preparation).not.toBeNull();
      expect(
        await publications.execute({
          ...request,
          expectedState: preparation!.expectedState,
          publishedAt: NOW,
        }),
      ).toMatchObject({ state: 'changed' });
    };
    return {
      db,
      directory,
      storage,
      pages,
      service,
      publications,
      approvals,
      identity,
      saveAt,
      retained,
      pending,
      publish,
      dispose,
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}

test('saves retain the last five, the inclusive 24-hour window, publication and valid approval, scoped to one page and owner', async () => {
  const context = await setup();
  try {
    for (let index = 0; index < HISTORY_COUNT; index++) {
      await context.saveAt();
      await context.saveAt({ ownerId: 'owner-b' });
      await context.saveAt({ title: 'Other' });
    }
    const current = (await context.pages.find(context.identity))!;
    const before = await context.pages.revisionsByNumber({
      ...context.identity,
      revisionNumbers: [1],
    });
    await context.db`
      insert into "entity" ("id", "owner_id", "readable_id", "name", "description", "created_at", "updated_at")
      values ('subject', ${OWNER}, 'subject', 'Subject', 'Test subject', ${NOW}, ${NOW})
    `;
    await context.db`
      insert into "knowledge_page_entity_mention" ("owner_id", "source_revision_id", "target_entity_id")
      select ${OWNER}, "id", 'subject' from "knowledge_page_revision" where "page_id" = ${current.id} and "revision_number" = 1
    `;
    await context.publish(2);
    const request = {
      ...context.identity,
      resourceType: 'page',
      action: 'publish',
      revisionNumber: 3,
    } as const;
    const preparation = (await context.publications.prepare(request))!;
    const approval = await context.approvals.create({
      request,
      sessionId: OWNER,
      challenge: 'review-third',
      expectedState: preparation.expectedState,
      now: NOW,
    });
    expect(approval).not.toBeNull();
    await context.db`
      update "knowledge_page_revision" set "created_at" = ${OLD}
      where "owner_id" = ${OWNER} and "page_id" = ${current.id}
    `;
    await context.db`
      update "knowledge_page_revision" set "created_at" = ${CUTOFF}
      where "owner_id" = ${OWNER} and "page_id" = ${current.id} and "revision_number" = 9
    `;
    await context.db`
      update "knowledge_page_revision" set "created_at" = '2026-10-03T12:00:00.001Z'
      where "owner_id" = ${OWNER} and "page_id" = ${current.id} and "revision_number" = 10
    `;
    expect((await context.saveAt()).revisionNumber).toBe(NEXT_REVISION);
    expect(await context.retained()).toEqual([16, 15, 14, 13, 12, 10, 9, 3, 2]);
    expect(await context.retained({ ownerId: 'owner-b', readableId: 'notes' })).toHaveLength(
      HISTORY_COUNT,
    );
    expect(await context.retained({ ownerId: OWNER, readableId: 'other' })).toHaveLength(
      HISTORY_COUNT,
    );
    expect(await context.pending({ pageId: current.id, ownerId: 'owner-b' })).toEqual([]);
    expect(
      await context.pages.revisionsByNumber({ ...context.identity, revisionNumbers: [1] }),
    ).toHaveLength(0);
    expect(await context.storage.exists(before[0]!.storageKey)).toBe(true);
    expect(await context.db`select "id" from "entity" where "id" = 'subject'`).toHaveLength(1);
    expect(
      await context.db`select * from "knowledge_page_entity_mention" where "target_entity_id" = 'subject'`,
    ).toHaveLength(0);
    expect(
      await context.db`select "sequence" from "resource_change" where "owner_id" = ${OWNER} and "readable_id" = 'notes'`,
    ).toHaveLength(NEXT_REVISION);
    expect(
      await context.approvals.find({
        ownerId: OWNER,
        sessionId: OWNER,
        approvalId: approval!.id,
        now: NOW,
      }),
    ).not.toBeNull();
    expect(await context.publications.prepare(request)).not.toBeNull();
    await context.saveAt({ now: EXPIRES });
    expect(await context.retained()).toEqual([17, 16, 15, 14, 13, 2]);
    const withdrawal = { ...context.identity, resourceType: 'page', action: 'unpublish' } as const;
    const prepared = (await context.publications.prepare(withdrawal))!;
    await context.publications.execute({
      ...withdrawal,
      expectedState: prepared.expectedState,
      publishedAt: EXPIRES,
    });
    await context.saveAt({ now: EXPIRES });
    expect(await context.retained()).toEqual([18, 17, 16, 15, 14]);
  } finally {
    await context.dispose();
  }
});

test('replacing the public revision releases its old protection on the next save', async () => {
  const context = await setup();
  try {
    for (let index = 0; index < HISTORY_COUNT; index++) {
      await context.saveAt();
    }
    await context.publish(1);
    await context.db`update "knowledge_page_revision" set "created_at" = ${OLD}`;
    await context.saveAt();
    expect(await context.retained()).toEqual([16, 15, 14, 13, 12, 1]);
    await context.publish(NEXT_REVISION);
    await context.saveAt();
    expect(await context.retained()).toEqual([17, 16, 15, 14, 13]);
  } finally {
    await context.dispose();
  }
});

test('a protected approval can publish after pruning, and consumption does not retain a withdrawn version', async () => {
  const context = await setup();
  try {
    for (let index = 0; index < HISTORY_COUNT; index++) {
      await context.saveAt();
    }
    await context.db`update "knowledge_page_revision" set "created_at" = ${OLD}`;
    const request = {
      ...context.identity,
      resourceType: 'page',
      action: 'publish',
      revisionNumber: 1,
    } as const;
    const prepared = (await context.publications.prepare(request))!;
    const approval = (await context.approvals.create({
      request,
      sessionId: OWNER,
      challenge: 'publish-first',
      expectedState: prepared.expectedState,
      now: NOW,
    }))!;
    await context.saveAt();
    expect(await context.retained()).toEqual([16, 15, 14, 13, 12, 1]);
    const credential = {
      id: 'passkey',
      credentialId: 'credential',
      publicKey: 'public-key',
      counter: 0,
      transports: null,
    };
    await context.db`
      insert into "auth_passkey" ("id", "userId", "credentialID", "publicKey", "counter", "deviceType", "backedUp")
      values (${credential.id}, ${OWNER}, ${credential.credentialId}, ${credential.publicKey}, 0, 'singleDevice', 0)
    `;
    expect(
      await context.approvals.completeVerifiedApproval({
        ownerId: OWNER,
        sessionId: OWNER,
        approvalId: approval.id,
        credential,
        newCounter: 1,
        now: NOW,
      }),
    ).toMatchObject({ state: 'changed' });
    expect(
      await context.approvals.find({
        ownerId: OWNER,
        sessionId: OWNER,
        approvalId: approval.id,
        now: NOW,
      }),
    ).toBeNull();
    const withdrawal = { ...context.identity, resourceType: 'page', action: 'unpublish' } as const;
    const preparedWithdrawal = (await context.publications.prepare(withdrawal))!;
    await context.publications.execute({
      ...withdrawal,
      expectedState: preparedWithdrawal.expectedState,
      publishedAt: NOW,
    });
    await context.saveAt();
    expect(await context.retained()).toEqual([17, 16, 15, 14, 13]);
    // An already prepared review cannot acquire protection after its content has been pruned.
    expect(
      await context.approvals.create({
        request,
        sessionId: OWNER,
        challenge: 'late-review',
        expectedState: prepared.expectedState,
        now: NOW,
      }),
    ).toBeNull();
  } finally {
    await context.dispose();
  }
});

test('expired sessions do not pin old revisions even when their approval has not expired', async () => {
  const context = await setup();
  try {
    for (let index = 0; index < HISTORY_COUNT; index++) {
      await context.saveAt();
    }
    const request = {
      ...context.identity,
      resourceType: 'page',
      action: 'publish',
      revisionNumber: 1,
    } as const;
    const prepared = (await context.publications.prepare(request))!;
    await context.approvals.create({
      request,
      sessionId: OWNER,
      challenge: 'expired-session',
      expectedState: prepared.expectedState,
      now: NOW,
    });
    await context.db`update "auth_session" set "expiresAt" = ${NOW} where "id" = ${OWNER}`;
    await context.db`update "knowledge_page_revision" set "created_at" = ${OLD}`;
    await context.saveAt();
    expect(await context.retained()).toEqual([16, 15, 14, 13, 12]);
  } finally {
    await context.dispose();
  }
});

test('file deletion failure survives restart and an identical save retries cleanup without adding history', async () => {
  const context = await setup();
  try {
    for (let index = 0; index < HISTORY_COUNT; index++) {
      await context.saveAt();
    }
    const current = (await context.pages.find(context.identity))!;
    const old = (
      await context.pages.revisionsByNumber({ ...context.identity, revisionNumbers: [1] })
    )[0]!;
    await context.db`update "knowledge_page_revision" set "created_at" = ${OLD}`;
    const failingStorage = {
      write: context.storage.write.bind(context.storage),
      file: context.storage.file.bind(context.storage),
      size: context.storage.size.bind(context.storage),
      exists: context.storage.exists.bind(context.storage),
      delete: async (key: string) => {
        if (key === old.storageKey) {
          throw new Error('Storage unavailable');
        }
        await context.storage.delete(key);
      },
    };
    const service = new KnowledgePagesService({ pages: context.pages, storage: failingStorage });
    const input = {
      ...context.identity,
      actor: { kind: 'owner' } as const,
      message: 'Save notes',
      markdown: '# Notes\n\nLatest content.\n',
      expectedRevisionNumber: current.revisionNumber,
    };
    expect(await service.update(input)).toMatchObject({
      state: 'saved',
      page: { revisionNumber: NEXT_REVISION },
    });
    expect(await context.retained()).toEqual([16, 15, 14, 13, 12]);
    expect(await context.pending({ pageId: current.id })).toEqual([old.storageKey]);
    expect(await context.storage.exists(old.storageKey)).toBe(true);
    const restarted = new KnowledgePagesService({
      pages: new KnowledgePagesRepository(context.db),
      storage: context.storage,
    });
    expect(
      await restarted.update({ ...input, expectedRevisionNumber: NEXT_REVISION }),
    ).toMatchObject({ state: 'saved', page: { revisionNumber: NEXT_REVISION } });
    expect(await context.pending({ pageId: current.id })).toEqual([]);
    expect(await context.storage.exists(old.storageKey)).toBe(false);
    expect(await context.db`select "sequence" from "resource_change"`).toHaveLength(NEXT_REVISION);
    const retained = await context.pages.revisionsByNumber({
      ...context.identity,
      revisionNumbers: [12, 13, 14, 15, 16],
    });
    for (const revision of retained) {
      expect(await context.storage.exists(revision.storageKey)).toBe(true);
    }
  } finally {
    await context.dispose();
  }
});

test('interruption after file deletion but before acknowledgement is safe to retry', async () => {
  const context = await setup();
  try {
    for (let index = 0; index < HISTORY_COUNT; index++) {
      await context.saveAt();
    }
    await context.db`update "knowledge_page_revision" set "created_at" = ${OLD}`;
    const current = await context.saveAt();
    const pending = await context.pending({ pageId: current.id });
    expect(pending.length).toBeGreaterThan(0);
    for (const key of pending) {
      await context.storage.delete(key);
    }
    expect(
      await context.service.update({
        ...context.identity,
        actor: { kind: 'owner' },
        message: 'Retry cleanup',
        expectedRevisionNumber: current.revisionNumber,
        markdown: '# Notes\n\nVersion 16.\n',
      }),
    ).toMatchObject({ state: 'saved', page: { revisionNumber: NEXT_REVISION } });
    expect(await context.pending({ pageId: current.id })).toEqual([]);
  } finally {
    await context.dispose();
  }
});

test('failed saves and stale identical saves cannot prune history or advance the revision', async () => {
  const context = await setup();
  try {
    for (let index = 0; index < HISTORY_COUNT; index++) {
      await context.saveAt();
    }
    await context.db`update "knowledge_page_revision" set "created_at" = ${OLD}`;
    const input = {
      ...context.identity,
      actor: { kind: 'owner' } as const,
      message: 'Save notes',
      expectedRevisionNumber: HISTORY_COUNT,
    };
    expect(
      await context.service.update({
        ...input,
        expectedRevisionNumber: 1,
        markdown: '# Notes\n\nVersion 15.\n',
      }),
    ).toEqual({ state: 'revision_conflict', currentRevisionNumber: HISTORY_COUNT });
    expect(
      await context.service.update({
        ...input,
        markdown: '# Notes\n\n[Missing](context-use://page/missing)\n',
      }),
    ).toMatchObject({ state: 'link_target_not_found' });
    await context.db.unsafe(
      `create trigger fail_pruning before delete on knowledge_page_revision begin select raise(abort, 'pruning failed'); end`,
    );
    await expect(
      context.service.update({ ...input, markdown: '# Notes\n\nChanged.\n' }),
    ).rejects.toThrow('pruning failed');
    expect(await context.retained()).toHaveLength(HISTORY_COUNT);
    const current = (await context.pages.find(context.identity))!;
    expect(current.revisionNumber).toBe(HISTORY_COUNT);
    expect(await context.pending({ pageId: current.id })).toEqual([]);
    expect(await context.db`select "sequence" from "resource_change"`).toHaveLength(HISTORY_COUNT);
    const metadataOnly = {
      ...input,
      markdown: '# Notes\n\nVersion 15.\n',
      temporalCoverage: '2026',
    };
    await context.db.unsafe('drop trigger fail_pruning');
    expect(await context.service.update(metadataOnly)).toMatchObject({
      state: 'saved',
      page: { revisionNumber: NEXT_REVISION, temporalCoverage: '2026' },
    });
  } finally {
    await context.dispose();
  }
});
