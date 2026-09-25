import { expect, test } from 'bun:test';
import { StatusMap } from 'elysia';
import { RecordPublicationConflictError } from '#backend/models/records/model.ts';
import { HypermediaRetrievalRepository } from '#backend/repositories/hypermedia-retrieval/repository.ts';
import { CHANGE, NOW, withPublicResources } from './fixture.ts';

const OWNER = 'owner-a';
const LATER = '2026-09-25T10:00:00.000Z';
const SOURCE = {
  provider: 'calendar',
  kind: 'meeting',
  id: 'private-source-id',
  url: 'https://private.example/source',
};
const target = (readableId: string) => ({
  ownerId: OWNER,
  resourceType: 'record' as const,
  readableId,
  action: 'publish' as const,
});

function request({
  app,
  id,
  markdown = false,
}: {
  app: Parameters<Parameters<typeof withPublicResources>[0]>[0]['app'];
  id: string;
  markdown?: boolean;
}) {
  return app.handle(
    new Request(
      `http://localhost/public/records/${encodeURIComponent(id)}${markdown ? '/markdown' : ''}`,
    ),
  );
}

test('public record readers use a stable handle, sanitize source Markdown, and show later sync updates', () =>
  withPublicResources(async ({ records, publications, transition, app }) => {
    const input = {
      ownerId: OWNER,
      change: CHANGE,
      sync: { syncId: 'sync-test', revision: 1 },
      record: {
        source: SOURCE,
        title: 'Meeting notes',
        body: 'Approved evidence.\n\n[External](https://example.com) [private](context-use://page/private)\n\n<script>unsafe()</script>\n\n![tracker](https://external.example/pixel)',
        sourceUpdatedAt: NOW,
      },
    };
    const { readableId } = await records.upsert(input);
    expect((await request({ app, id: readableId })).status).toBe(StatusMap['Not Found']);
    const publicId = await transition(target(readableId));
    expect(publicId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    const html = await request({ app, id: publicId });
    expect(html.status).toBe(StatusMap.OK);
    expect(html.headers.get('cache-control')).toBe('private, no-store');
    const body = await html.text();
    expect(body).toContain('Meeting notes');
    expect(body).toContain('Approved evidence.');
    for (const secret of [
      readableId,
      SOURCE.id,
      SOURCE.url,
      'context-use://',
      'unsafe()',
      'external.example/pixel',
    ]) {
      expect(body).not.toContain(secret);
    }
    const markdown = await request({ app, id: publicId, markdown: true });
    expect(markdown.headers.get('content-type')).toContain('text/markdown');
    expect(await markdown.text()).toContain('[External](https://example.com)');
    await records.upsert({
      ...input,
      sync: { syncId: 'sync-test', revision: 2 },
      record: {
        ...input.record,
        title: 'Updated title',
        body: 'New synced evidence.',
        sourceUpdatedAt: LATER,
      },
    });
    expect(await (await request({ app, id: publicId })).text()).toContain('New synced evidence.');
    expect(await publications.recordStatus(target(readableId))).toEqual({
      publicId,
      publishedAt: NOW,
    });
    await transition({ ...target(readableId), action: 'unpublish' });
    expect((await request({ app, id: publicId })).status).toBe(StatusMap['Not Found']);
    expect((await request({ app, id: publicId, markdown: true })).status).toBe(
      StatusMap['Not Found'],
    );
    expect(await transition(target(readableId))).toBe(publicId);
  }));

test('pages may reference published records and keep them public until the published reference is removed', () =>
  withPublicResources(
    async ({
      records,
      create,
      update,
      publish,
      publications,
      transition,
      request: pageRequest,
    }) => {
      const { readableId } = await records.upsert({
        ownerId: OWNER,
        change: CHANGE,
        record: { source: SOURCE, title: 'Source meeting', body: 'Evidence', sourceUpdatedAt: NOW },
      });
      const page = await create({
        markdown: `# Summary\n\n[Meeting](context-use://record/${readableId})`,
      });
      const pageTarget = {
        ownerId: OWNER,
        resourceType: 'page' as const,
        readableId: page.readableId,
        action: 'publish' as const,
        revisionNumber: 1,
      };
      expect((await publications.prepare(pageTarget))?.blockers).toEqual([
        {
          reason: 'reference_not_public',
          resource: { resourceType: 'record', readableId, name: 'Source meeting' },
        },
      ]);
      const recordId = await transition(target(readableId));
      const pageId = await publish({ readableId: page.readableId });
      expect(await (await pageRequest({ id: pageId, markdown: true })).text()).toContain(
        `/public/records/${recordId}`,
      );
      await update({
        readableId: page.readableId,
        markdown: '# Summary\n\nNo reference in the private draft.',
      });
      const withdrawal = { ...target(readableId), action: 'unpublish' as const };
      expect((await publications.prepare(withdrawal))?.blockers).toEqual([
        {
          reason: 'public_page_reference',
          resource: { resourceType: 'page', readableId: page.readableId, name: 'Summary' },
        },
      ]);
      await publish({ readableId: page.readableId, revisionNumber: 2 });
      expect((await publications.prepare(withdrawal))?.blockers).toEqual([]);
      await transition(withdrawal);
    },
  ));

test('published records enforce asset dependencies and reject unsafe sync mutations atomically', () =>
  withPublicResources(async ({ records, assets, publications, transition, targets, app }) => {
    const { asset, assetId } = await targets();
    const privateAsset = await assets.create({
      ownerId: OWNER,
      name: 'Private attachment',
      file: new Blob(['Secret']),
      change: CHANGE,
    });
    if (privateAsset.state !== 'created') {
      throw new Error('Missing asset');
    }
    const input = {
      ownerId: OWNER,
      change: CHANGE,
      record: {
        source: SOURCE,
        title: 'Record with image',
        body: `![Image](context-use://asset/${asset.readableId})\n\n[Image](context-use://asset/${asset.readableId})`,
        sourceUpdatedAt: NOW,
      },
    };
    const { readableId } = await records.upsert(input);
    const recordId = await transition(target(readableId));
    const markdown = await (await request({ app, id: recordId, markdown: true })).text();
    expect(markdown).toContain(`/public/assets/${assetId}`);
    const assetWithdrawal = {
      ownerId: OWNER,
      resourceType: 'asset' as const,
      readableId: asset.readableId,
      action: 'unpublish' as const,
    };
    expect((await publications.prepare(assetWithdrawal))?.blockers).toEqual([
      {
        reason: 'public_record_reference',
        resource: { resourceType: 'record', readableId, name: 'Record with image' },
      },
    ]);
    const changed = {
      ...input.record,
      body: `[Secret](context-use://asset/${privateAsset.asset.readableId})`,
      sourceUpdatedAt: LATER,
    };
    expect(records.upsert({ ...input, record: changed })).rejects.toThrow(
      RecordPublicationConflictError,
    );
    expect((await records.findResource({ ownerId: OWNER, readableId }))?.body).toBe(
      input.record.body,
    );
    expect(await (await request({ app, id: recordId, markdown: true })).text()).toBe(markdown);
    expect(
      records.remove({
        ownerId: OWNER,
        source: { provider: SOURCE.provider, kind: SOURCE.kind, id: SOURCE.id },
        sourceUpdatedAt: LATER,
        change: CHANGE,
      }),
    ).rejects.toThrow('Unpublish this record');
    await transition({ ...target(readableId), action: 'unpublish' });
    await records.upsert({ ...input, record: changed });
    expect((await publications.prepare(target(readableId)))?.blockers).toEqual([
      {
        reason: 'reference_not_public',
        resource: {
          resourceType: 'asset',
          readableId: privateAsset.asset.readableId,
          name: 'Private attachment',
        },
      },
    ]);
    expect((await publications.prepare(assetWithdrawal))?.blockers).toEqual([]);
  }));

test('record visibility filters include public records before pagination and ranking within the owner', () =>
  withPublicResources(async ({ records, transition, database, storage }) => {
    const input = {
      ownerId: OWNER,
      change: CHANGE,
      record: {
        source: SOURCE,
        title: 'Searchable public meeting',
        body: 'Evidence',
        sourceUpdatedAt: NOW,
      },
    };
    const publicRecord = await records.upsert(input);
    const privateRecord = await records.upsert({
      ...input,
      record: {
        ...input.record,
        source: { ...SOURCE, id: 'private' },
        title: 'Searchable private meeting',
      },
    });
    const foreign = await records.upsert({ ...input, ownerId: 'owner-b' });
    await transition({ ...target(foreign.readableId), ownerId: 'owner-b' });
    expect(
      (await records.listResources({ ownerId: OWNER, limit: 1, offset: 0, visibility: 'public' }))
        .items,
    ).toEqual([]);
    await transition(target(publicRecord.readableId));
    expect(
      (
        await records.listResources({ ownerId: OWNER, limit: 1, offset: 0, visibility: 'public' })
      ).items.map((r) => r.readableId),
    ).toEqual([publicRecord.readableId]);
    expect(
      (
        await records.listResources({ ownerId: OWNER, limit: 1, offset: 0, visibility: 'private' })
      ).items.map((r) => r.readableId),
    ).toEqual([privateRecord.readableId]);
    const search = new HypermediaRetrievalRepository({ database, storage });
    expect(
      await search.search({
        ownerId: OWNER,
        query: 'Searchable',
        resourceTypes: ['record'],
        limit: 1,
        filters: { visibility: 'public' },
      }),
    ).toMatchObject({
      totalMatches: 1,
      truncated: false,
      results: [{ record: { readableId: publicRecord.readableId, publishedAt: NOW } }],
    });
  }));
