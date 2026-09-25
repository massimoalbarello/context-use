import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Elysia, StatusMap } from 'elysia';
import { createSqliteDatabase } from '#backend/db/client.ts';
import { runMigrations } from '#backend/db/migrate.ts';
import { elysiaErrorHandler } from '#backend/lib/errors.ts';
import { LocalStorage } from '#backend/lib/storage/local-storage.ts';
import { AssetsRepository } from '#backend/repositories/assets/repository.ts';
import { EntitiesRepository } from '#backend/repositories/entities/repository.ts';
import { KnowledgePagesRepository } from '#backend/repositories/knowledge-pages/repository.ts';
import { PublicResourcesRepository } from '#backend/repositories/public-resources/repository.ts';
import {
  type PublicationRequest,
  PublicationsRepository,
} from '#backend/repositories/publications/repository.ts';
import { createPublicController } from '#backend/routes/public/controller.ts';
import { AssetsService } from '#backend/services/assets/service.ts';
import { KnowledgePagesService } from '#backend/services/knowledge-pages/service.ts';
import { PublicResourcesService } from '#backend/services/public-resources/service.ts';
import { unusedAssetFacesService } from '../../support/app.ts';

const NOW = '2026-09-24T09:00:00.000Z';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6Z5sAAAAASUVORK5CYII=',
  'base64',
);
const ACTOR = { kind: 'owner' } as const;
const CHANGE = { clientName: null, message: 'Test publication' };

async function withPublicPages(
  run: (fixture: Awaited<ReturnType<typeof createFixture>>) => Promise<void>,
) {
  const folder = await mkdtemp(join(tmpdir(), 'context-use-public-pages-'));
  const database = await createSqliteDatabase({ dataFolder: folder });
  try {
    await runMigrations({ db: database });
    await run(await createFixture({ database, folder }));
  } finally {
    await database.close();
    await rm(folder, { recursive: true, force: true });
  }
}

async function createFixture({
  database,
  folder,
}: {
  database: Awaited<ReturnType<typeof createSqliteDatabase>>;
  folder: string;
}) {
  for (const owner of ['owner-a', 'owner-b']) {
    await database`insert into "auth_user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
      values (${owner}, 'Private author name', ${`${owner}@example.invalid`}, 1, ${NOW}, ${NOW})`;
  }
  const storage = new LocalStorage(join(folder, 'objects'));
  const repository = new KnowledgePagesRepository(database);
  const pages = new KnowledgePagesService({ pages: repository, storage });
  const entities = new EntitiesRepository(database);
  const assets = new AssetsService({
    assets: new AssetsRepository(database),
    storage,
    faces: unusedAssetFacesService,
  });
  const resources = new PublicResourcesRepository(database);
  const service = new PublicResourcesService({ resources, storage });
  const publications = new PublicationsRepository(database);
  const app = new Elysia()
    .onError(elysiaErrorHandler)
    .use(createPublicController({ publicResourcesService: service }));
  async function create({ markdown, ownerId = 'owner-a' }: { markdown: string; ownerId?: string }) {
    const result = await pages.create({
      ownerId,
      actor: ACTOR,
      message: 'Private creation message',
      markdown,
    });
    if (result.state !== 'saved') {
      throw new Error(JSON.stringify(result));
    }
    return result.page;
  }
  async function update({ readableId, markdown }: { readableId: string; markdown: string }) {
    const current = await pages.detail({ ownerId: 'owner-a', readableId });
    const result = await pages.update({
      ownerId: 'owner-a',
      readableId,
      actor: ACTOR,
      message: 'Private update message',
      markdown,
      expectedRevisionNumber: current!.revisionNumber,
    });
    if (result.state !== 'saved') {
      throw new Error(JSON.stringify(result));
    }
    return result.page;
  }
  async function transition(request: PublicationRequest) {
    const preparation = await publications.prepare(request);
    if (!preparation) {
      throw new Error('Missing preparation');
    }
    const result = await publications.execute({
      ...request,
      expectedState: preparation.expectedState,
      publishedAt: NOW,
    });
    if (result.state !== 'changed' || !result.publication.publicId) {
      throw new Error(JSON.stringify(result));
    }
    return result.publication.publicId;
  }
  const publish = ({
    readableId,
    revisionNumber = 1,
  }: {
    readableId: string;
    revisionNumber?: number;
  }) =>
    transition({
      ownerId: 'owner-a',
      resourceType: 'page',
      action: 'publish',
      readableId,
      revisionNumber,
    });
  const request = ({
    id,
    markdown = false,
    cookie,
    query = '',
  }: {
    id: string;
    markdown?: boolean;
    cookie?: string;
    query?: string;
  }) =>
    app.handle(
      new Request(
        `http://localhost/public/pages/${encodeURIComponent(id)}${markdown ? '/markdown' : ''}${query}`,
        { headers: cookie ? { cookie } : {} },
      ),
    );
  async function targets() {
    const page = await create({ markdown: '# Linked public page\n\nApproved linked content.' });
    const pageId = await publish({ readableId: page.readableId });
    const entityResult = await entities.create({
      id: Bun.randomUUIDv7(),
      ownerId: 'owner-a',
      readableId: 'private-entity-readable-id',
      name: 'Entity live name',
      description: 'Private description not used here',
      createdAt: NOW,
      change: CHANGE,
    });
    if (entityResult.state !== 'created') {
      throw new Error('Missing entity');
    }
    const entity = entityResult.entity;
    const entityId = await transition({
      ownerId: 'owner-a',
      resourceType: 'entity',
      action: 'publish',
      readableId: entity.readableId,
    });
    const assetResult = await assets.create({
      ownerId: 'owner-a',
      name: 'Private image name',
      file: new Blob([PNG]),
      change: CHANGE,
    });
    if (assetResult.state !== 'created') {
      throw new Error('Missing image');
    }
    const asset = assetResult.asset;
    const assetId = await transition({
      ownerId: 'owner-a',
      resourceType: 'asset',
      action: 'publish',
      readableId: asset.readableId,
    });
    return { page, pageId, entity, entityId, asset, assetId };
  }
  return {
    database,
    storage,
    repository,
    resources,
    service,
    entities,
    assets,
    create,
    update,
    publish,
    transition,
    request,
    targets,
    app,
  };
}

test('HTML and Markdown expose only the exact approved revision and retained links until explicit replacement', async () => {
  await withPublicPages(
    async ({
      targets,
      create,
      publish,
      request,
      update,
      entities,
      resources,
      service,
      transition,
    }) => {
      const target = await targets();
      const page = await create({
        markdown: `# Approved title\n\n[Authored label][page] and [second label][page].\n\n[Authored entity](context-use://entity/${target.entity.readableId})\n\n![Chart][asset]\n\n[Download chart][asset]\n\n[page]: context-use://page/${target.page.readableId}#evidence\n[asset]: context-use://asset/${target.asset.readableId}`,
      });
      const id = await publish({ readableId: page.readableId });
      const before = [];
      for (const markdown of [false, true]) {
        const response = await request({ id: id, ...{ markdown } });
        expect(response.status).toBe(StatusMap.OK);
        const body = await response.text();
        before.push(body);
        expect(body.match(new RegExp(`/public/pages/${target.pageId}#evidence`, 'g'))).toEqual([
          `/public/pages/${target.pageId}#evidence`,
          `/public/pages/${target.pageId}#evidence`,
        ]);
        expect(body).toContain(`/public/entities/${target.entityId}`);
        expect(body).toContain(`/public/assets/${target.assetId}`);
        expect(body).toContain('Authored label');
        expect(body).toContain('second label');
        expect(body).toContain('Authored entity');
        for (const value of [
          page.id,
          page.readableId,
          target.page.readableId,
          target.entity.readableId,
          target.asset.readableId,
          'Private author name',
          'Private creation message',
          'owner-a',
          'revisionNumber',
          'storageKey',
          'context-use://',
        ]) {
          expect(body).not.toContain(value);
        }
        expect(response.headers.get('cache-control')).toBe('private, no-store');
        expect(response.headers.get('x-content-type-options')).toBe('nosniff');
        expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
        expect(response.headers.get('content-security-policy')).not.toContain('unsafe-inline');
        expect(response.headers.get('content-security-policy')).toContain(
          'sandbox allow-same-origin allow-downloads',
        );
        const withCookie = await request({
          id: id,
          ...{
            markdown,
            cookie: 'better-auth.session_token=owner-session',
          },
        });
        expect([...withCookie.headers]).toEqual([...response.headers]);
        expect(await withCookie.text()).toBe(body);
        expect(
          await (
            await request({
              id: id,
              ...{ markdown, query: '?revisionNumber=2&revision=2&from=0&to=2' },
            })
          ).text(),
        ).toBe(body);
      }
      expect(before[0]).toContain('<title>Approved title</title>');
      expect(before[0]).toContain(`href="/public/assets/${target.assetId}">Download chart</a>`);
      expect(before[1]).toContain(`[Download chart](/public/assets/${target.assetId})`);
      expect(before[0]).toContain('View Markdown');
      expect(Object.keys((await resources.findPage({ publicId: id }))!).sort()).toEqual([
        'contentHash',
        'sizeBytes',
        'storageKey',
        'targets',
        'title',
      ]);
      expect(Object.keys((await service.pageContent({ publicId: id }))!).sort()).toEqual([
        'markdown',
        'title',
      ]);
      await update({
        readableId: target.page.readableId,
        markdown: '# PRIVATE latest linked title\n\nPrivate linked draft.',
      });
      await entities.update({
        ownerId: 'owner-a',
        readableId: target.entity.readableId,
        name: 'Changed live entity name',
        description: 'Changed description',
        updatedAt: NOW,
        change: CHANGE,
      });
      const privateTarget = await create({ markdown: '# Secret private target\n\nNot approved.' });
      await update({
        readableId: page.readableId,
        markdown: `# PRIVATE latest title\n\nPrivate latest body [private target](context-use://page/${privateTarget.readableId}).`,
      });
      expect(await (await request({ id: id })).text()).toBe(before[0]!);
      expect(await (await request({ id: id, ...{ markdown: true } })).text()).toBe(before[1]!);
      const replacement = await update({
        readableId: page.readableId,
        markdown: '# Explicit replacement\n\nReplacement body.',
      });
      expect(
        await publish({ readableId: page.readableId, revisionNumber: replacement.revisionNumber }),
      ).toBe(id);
      for (const markdown of [false, true]) {
        const body = await (await request({ id: id, ...{ markdown } })).text();
        expect(body).toContain('Explicit replacement');
        expect(body).not.toContain('Approved title');
        expect(body).not.toContain('Private latest body');
      }
      expect(
        await transition({
          ownerId: 'owner-a',
          resourceType: 'page',
          action: 'unpublish',
          readableId: page.readableId,
        }),
      ).toBe(id);
      for (const markdown of [false, true]) {
        expect((await request({ id: id, ...{ markdown } })).status).toBe(StatusMap['Not Found']);
      }
    },
  );
});

test('both formats strip active and hidden destinations, omit external images, preserve authored code and heading fragments', async () => {
  await withPublicPages(async ({ create, publish, request, targets, assets, transition }) => {
    const target = await targets();
    const file = await assets.create({
      ownerId: 'owner-a',
      name: 'Document',
      file: new Blob(['%PDF-1.7\nPDF data']),
      change: CHANGE,
    });
    if (file.state !== 'created') {
      throw new Error('Missing file');
    }
    const fileId = await transition({
      ownerId: 'owner-a',
      resourceType: 'asset',
      action: 'publish',
      readableId: file.asset.readableId,
    });
    const source = `# Safe reading\n\nApproved prose stays.\n\n## Café **bold** and \`code\` ![ignored alt](context-use://asset/${target.asset.readableId})\n\n[section](#cafe-bold-and-code) [website](https://example.com/a?q=1) [email](mailto:person@example.com)\n\n[unsafe](javascript:alert%281%29) [data](data:text/html,bad) [private](/pages/secret) [relative](../api/pages/secret) [protocol](//example.com/track)\n\n![tracker](https://example.com/secret.png) ![reference tracker][external]\n\n![Document](context-use://asset/${file.asset.readableId}) [Get file](context-use://asset/${file.asset.readableId})\n\n<!-- private comment -->\n\n<script>alert('private script')</script>\n\n<div>private raw html</div>\n\n[unused]: /api/private-definition\n[external]: https://example.com/tracker.png\n\n\`context-use://page/literal-private-id\`\n\n\`<img src="https://example.com/literal.png">\`\n\n\`\`\`md\n[Authored code](context-use://record/private-code-id)\n\`\`\``;
    const page = await create({ markdown: source });
    const id = await publish({ readableId: page.readableId });
    for (const markdown of [false, true]) {
      const response = await request({ id: id, ...{ markdown } });
      expect(response.status).toBe(StatusMap.OK);
      expect(response.headers.get('content-type')).toBe(
        markdown ? 'text/markdown; charset=utf-8' : 'text/html; charset=utf-8',
      );
      const body = await response.text();
      for (const hidden of [
        'private comment',
        'private script',
        'private raw html',
        'private-definition',
        'tracker.png',
        'secret.png',
        'javascript:',
        'data:text',
        '/pages/secret',
        '../api/pages',
        '//example.com/track',
      ]) {
        expect(body).not.toContain(hidden);
      }
      expect(body).toContain('context-use://page/literal-private-id');
      expect(body).toContain('[Authored code](context-use://record/private-code-id)');
      expect(body).toContain(`/public/assets/${target.assetId}`);
      expect(body).toContain(`/public/assets/${fileId}`);
      expect(body).toContain('https://example.com/a?q=1');
      expect(body).toContain('mailto:person@example.com');
      expect(body).toContain('Approved prose stays.');
      if (markdown) {
        expect(body).not.toContain('![Document]');
      } else {
        expect(body).toContain('id="cafe-bold-and-code"');
        expect(body).not.toContain(`<img src="/public/assets/${fileId}"`);
        expect(body).not.toContain('<script');
      }
    }
  });
});

test('local and managed fragments resolve to safe headings without exposing removed HTML in identifiers', async () => {
  await withPublicPages(async ({ create, publish, request }) => {
    const target = await create({
      markdown:
        '# Linked heading\n\n[Local jump](#some-heading)\n\n## Some <em data-private="attribute-token">heading</em><!--comment-token-->\n\nVisible content.',
    });
    const targetId = await publish({ readableId: target.readableId });
    const source = await create({
      markdown: `# Source page\n\n[Section label](context-use://page/${target.readableId}#some-heading)`,
    });
    const sourceId = await publish({ readableId: source.readableId });
    for (const markdown of [false, true]) {
      const destination = await (await request({ id: targetId, markdown })).text();
      const referring = await (await request({ id: sourceId, markdown })).text();
      expect(referring).toContain(`/public/pages/${targetId}#some-heading`);
      expect(referring).toContain('Section label');
      expect(destination).toContain(
        markdown ? '[Local jump](#some-heading)' : 'href="#some-heading"',
      );
      if (!markdown) {
        expect(destination).toContain('id="some-heading"');
      }
      for (const removed of [
        'attribute-token',
        'comment-token',
        'data-private',
        '<em',
        'some-em',
      ]) {
        expect(destination).not.toContain(removed);
        expect(referring).not.toContain(removed);
      }
    }
  });
});

test('anonymous readers can follow inline and reference links between published revisions after private edits', async () => {
  await withPublicPages(async ({ create, update, publish, app }) => {
    const source = await create({ markdown: '# Public introduction\n\nApproved introduction.' });
    const sourceId = await publish({ readableId: source.readableId });
    const target = await create({
      markdown: `# Public project\n\n## Project details\n\nApproved project details.\n\n[Back to introduction](context-use://page/${source.readableId})`,
    });
    const targetId = await publish({ readableId: target.readableId });
    const linkedSource = await update({
      readableId: source.readableId,
      markdown: `# Public introduction\n\n[Explore the project][project]\n\n[project]: context-use://page/${target.readableId}#project-details`,
    });
    await publish({ readableId: source.readableId, revisionNumber: linkedSource.revisionNumber });
    for (const page of [source, target]) {
      await update({
        readableId: page.readableId,
        markdown:
          '# Unpublished replacement\n\nPrivate details without the public links or headings.',
      });
    }

    async function read(url: URL) {
      const requestUrl = new URL(url);
      // Browsers resolve the fragment locally and omit it from the HTTP request.
      requestUrl.hash = '';
      const response = await app.handle(new Request(requestUrl));
      expect(response.status).toBe(StatusMap.OK);
      const links: string[] = [];
      const headingIds: string[] = [];
      const html = await new HTMLRewriter()
        .on('article a[href]', {
          element(element) {
            links.push(element.getAttribute('href')!);
          },
        })
        .on('article h2[id]', {
          element(element) {
            headingIds.push(element.getAttribute('id')!);
          },
        })
        .transform(response)
        .text();
      expect(html).not.toContain('Unpublished replacement');
      expect(html).not.toContain('Private details');
      return { html, links, headingIds };
    }

    const sourceUrl = new URL(`http://localhost/public/pages/${sourceId}`);
    const introduction = await read(sourceUrl);
    expect(introduction.links).toEqual([`/public/pages/${targetId}#project-details`]);
    const targetUrl = new URL(introduction.links[0]!, sourceUrl);
    const project = await read(targetUrl);
    expect(project.html).toContain('Approved project details.');
    expect(project.headingIds).toContain(targetUrl.hash.slice(1));
    expect(project.links).toEqual([sourceUrl.pathname]);
    expect((await read(new URL(project.links[0]!, targetUrl))).html).toBe(introduction.html);
  });
});

test('private, foreign, unknown, withdrawn and archived page identifiers are indistinguishable and there is no history route', async () => {
  await withPublicPages(async ({ create, publish, request, transition, database, app }) => {
    const page = await create({ markdown: '# Public\n\nBody.' });
    const other = await create({ markdown: '# Foreign private page\n\nBody.', ownerId: 'owner-b' });
    const id = await publish({ readableId: page.readableId });
    await transition({
      ownerId: 'owner-a',
      resourceType: 'page',
      action: 'unpublish',
      readableId: page.readableId,
    });
    for (const candidate of [
      page.id,
      page.readableId,
      other.id,
      other.readableId,
      id,
      'page_unknown',
      'invalid!',
    ]) {
      for (const markdown of [false, true]) {
        const response = await request({ id: candidate, ...{ markdown } });
        expect(response.status).toBe(StatusMap['Not Found']);
        expect(await response.json()).toEqual({ error: 'Not Found' });
      }
    }
    await publish({ readableId: page.readableId });
    for (const path of ['revisions', 'revisions/1', 'history', 'archive']) {
      expect(
        (await app.handle(new Request(`http://localhost/public/pages/${id}/${path}`))).status,
      ).toBe(StatusMap['Not Found']);
    }
    await database`update "knowledge_page" set "archived_at" = ${NOW} where "id" = ${page.id}`;
    expect((await request({ id: id })).status).toBe(StatusMap['Not Found']);
  });
});

test('unavailable retained dependencies and missing relationship rows fail closed without publishing anything', async () => {
  await withPublicPages(async ({ targets, create, publish, request, database }) => {
    const target = await targets();
    const page = await create({
      markdown: `# Required dependencies\n\n[page](context-use://page/${target.page.readableId}) [entity](context-use://entity/${target.entity.readableId}) [asset](context-use://asset/${target.asset.readableId})`,
    });
    const id = await publish({ readableId: page.readableId });
    for (const [table, publicId] of [
      ['knowledge_page', target.pageId],
      ['entity', target.entityId],
      ['asset', target.assetId],
    ]) {
      // Simulate unavailable target data outside the guarded normal transitions.
      await database.unsafe(
        `update "${table}" set "published_at" = null${table === 'knowledge_page' ? ', "published_revision_id" = null' : ''} where "public_id" = $1`,
        [publicId!],
      );
      for (const markdown of [false, true]) {
        expect((await request({ id: id, ...{ markdown } })).status).toBe(StatusMap['Not Found']);
      }
      if (table === 'knowledge_page') {
        await publish({ readableId: target.page.readableId });
      } else {
        await database.unsafe(`update "${table}" set "published_at" = $1 where "public_id" = $2`, [
          NOW,
          publicId!,
        ]);
      }
      expect((await request({ id: id })).status).toBe(StatusMap.OK);
    }
    await database`delete from "knowledge_page_entity_mention" where "target_entity_id" = ${target.entity.id}`;
    for (const markdown of [false, true]) {
      expect((await request({ id: id, ...{ markdown } })).status).toBe(StatusMap['Not Found']);
    }
  });
});

test('cross-owner publication and dependency joins cannot expose another owner through a public page', async () => {
  await withPublicPages(async ({ targets, create, publish, request, database }) => {
    const target = await targets();
    const page = await create({
      markdown: `# Ownership\n\n[entity](context-use://entity/${target.entity.readableId})`,
    });
    const id = await publish({ readableId: page.readableId });
    await database.unsafe('pragma foreign_keys = off');
    await database`update "knowledge_page" set "owner_id" = 'owner-b' where "public_id" = ${id}`;
    expect((await request({ id: id })).status).toBe(StatusMap['Not Found']);
    await database`update "knowledge_page" set "owner_id" = 'owner-a' where "public_id" = ${id}`;
    await database`update "knowledge_page" set "published_revision_id" = (select "current_revision_id" from "knowledge_page" where "id" = ${target.page.id}) where "public_id" = ${id}`;
    expect((await request({ id })).status).toBe(StatusMap['Not Found']);
    await database`update "knowledge_page" set "published_revision_id" = (select "current_revision_id" from "knowledge_page" where "id" = ${page.id}) where "public_id" = ${id}`;
    await database`update "entity" set "owner_id" = 'owner-b' where "public_id" = ${target.entityId}`;
    expect((await request({ id: id })).status).toBe(StatusMap['Not Found']);
    await database.unsafe('pragma foreign_keys = on');
  });
});

test('missing, replaced and truncated published revision bytes never fall back to the current revision or leak errors', async () => {
  await withPublicPages(async ({ create, publish, update, request, resources, storage }) => {
    const page = await create({ markdown: '# Approved bytes\n\nExact approved body.' });
    const id = await publish({ readableId: page.readableId });
    const stored = (await resources.findPage({ publicId: id }))!;
    const original = new Uint8Array(await storage.file(stored.storageKey).arrayBuffer());
    await update({
      readableId: page.readableId,
      markdown: '# Secret fallback\n\nMust never reach public response.',
    });
    await storage.delete(stored.storageKey);
    for (const replacement of [null, Buffer.alloc(original.length), original.subarray(1)]) {
      if (replacement) {
        await storage.write(stored.storageKey, new Blob([replacement]));
      }
      for (const markdown of [false, true]) {
        const response = await request({ id: id, ...{ markdown } });
        expect(response.status).toBe(StatusMap['Internal Server Error']);
        expect(await response.json()).toEqual({ error: 'Internal server error' });
        expect(response.headers.get('cache-control')).toBe('private, no-store');
      }
    }
  });
});

test('unexpected managed targets and record references in verified revision content fail closed', async () => {
  await withPublicPages(async ({ create, publish, request, resources, storage, database }) => {
    const page = await create({ markdown: '# Approved\n\nContent.' });
    const id = await publish({ readableId: page.readableId });
    const stored = (await resources.findPage({ publicId: id }))!;
    for (const address of [
      'context-use://page/missing',
      'context-use://entity/missing',
      'context-use://asset/missing',
      'context-use://record/private-record',
      'context-use://page/invalid?revision=1',
    ]) {
      const markdown = `# Approved\n\n[Missing](${address})`;
      await storage.write(stored.storageKey, new Blob([markdown]));
      await database`update "knowledge_page_revision" set "size_bytes" = ${Buffer.byteLength(markdown)}, "content_hash" = ${new Bun.CryptoHasher('sha256').update(markdown).digest('hex')} where "storage_key" = ${stored.storageKey}`;
      for (const markdown of [false, true]) {
        const response = await request({ id: id, ...{ markdown } });
        expect(response.status).toBe(StatusMap['Not Found']);
        expect(await response.json()).toEqual({ error: 'Not Found' });
      }
    }
  });
});
