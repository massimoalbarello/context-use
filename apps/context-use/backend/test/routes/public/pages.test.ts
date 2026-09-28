import { expect, test } from 'bun:test';
import { StatusMap } from 'elysia';
import { CHANGE, NOW, withPublicResources } from './fixture.ts';

test('HTML and Markdown expose only the exact approved revision and retained links until explicit replacement', async () => {
  await withPublicResources(
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
      expect(before[0]).toContain('href="https://github.com/massimoalbarello/context-use"');
      expect(before[0]).toContain(`<time dateTime="${page.updatedAt}">`);
      expect(before[0]).toContain(`href="/public/assets/${target.assetId}">Download chart</a>`);
      expect(before[1]).toContain(`[Download chart](/public/assets/${target.assetId})`);
      expect(before[0]).toContain('View as Markdown');
      expect(Object.keys((await resources.findPage({ publicId: id }))!).sort()).toEqual([
        'contentHash',
        'modifiedAt',
        'sizeBytes',
        'storageKey',
        'targets',
        'title',
      ]);
      expect(Object.keys((await service.pageContent({ publicId: id }))!).sort()).toEqual([
        'markdown',
        'modifiedAt',
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
  await withPublicResources(async ({ create, publish, request, targets, assets, transition }) => {
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
  await withPublicResources(async ({ create, publish, request }) => {
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

test('cyclic and self references publish independently and follow live visibility in both public formats', async () => {
  await withPublicResources(
    async ({ create, update, publish, request, publications, transition }) => {
      const source = await create({ markdown: '# Public introduction\n\nApproved introduction.' });
      const target = await create({
        markdown: `# Confidential target title\n\n## Project details\n\nConfidential target body.\n\n[Back to introduction](context-use://page/${source.readableId})`,
      });
      const linkedSource = await update({
        readableId: source.readableId,
        markdown: `# Public introduction\n\n[Explore the project][project] and [another reference](context-use://page/${target.readableId} "Hidden link title").\n\n[This introduction](context-use://page/${source.readableId})\n\n[project]: context-use://page/${target.readableId}#project-details "Hidden reference title"`,
      });
      const sourceId = await publish({
        readableId: source.readableId,
        revisionNumber: linkedSource.revisionNumber,
      });
      expect(
        await publications.pageStatus({ ownerId: 'owner-a', readableId: target.readableId }),
      ).toEqual({
        publicId: null,
        publishedAt: null,
        publishedRevisionNumber: null,
      });

      async function readSource(targetId: string | null) {
        const bodies = [];
        for (const markdown of [false, true]) {
          const response = await request({ id: sourceId, markdown });
          expect(response.status).toBe(StatusMap.OK);
          const body = await response.text();
          expect(body).toContain('Explore the project');
          expect(body).toContain('another reference');
          expect(body).toContain(`/public/pages/${sourceId}`);
          for (const hidden of [
            target.id,
            target.readableId,
            'Confidential target title',
            'Confidential target body',
            'context-use://',
          ]) {
            expect(body).not.toContain(hidden);
          }
          if (targetId) {
            expect(body).toContain(`/public/pages/${targetId}#project-details`);
          } else {
            expect(body).not.toContain('Hidden link title');
            expect(body).not.toContain('Hidden reference title');
            expect(body).toContain('Explore the project and another reference.');
          }
          bodies.push(body);
        }
        return bodies;
      }

      const privateTargetBodies = await readSource(null);
      const targetId = await publish({ readableId: target.readableId });
      await readSource(targetId);
      for (const markdown of [false, true]) {
        const response = await request({ id: targetId, markdown });
        expect(response.status).toBe(StatusMap.OK);
        expect(await response.text()).toContain(`/public/pages/${sourceId}`);
      }
      await update({
        readableId: target.readableId,
        markdown: '# Unpublished replacement\n\nPrivate replacement body.',
      });
      for (const markdown of [false, true]) {
        const body = await (await request({ id: targetId, markdown })).text();
        expect(body).toContain('Confidential target body');
        expect(body).not.toContain('Private replacement body');
      }
      await transition({
        ownerId: 'owner-a',
        resourceType: 'page',
        action: 'unpublish',
        readableId: target.readableId,
      });
      expect(await readSource(null)).toEqual(privateTargetBodies);
      for (const markdown of [false, true]) {
        const response = await request({ id: targetId, markdown });
        expect(response.status).toBe(StatusMap['Not Found']);
        expect(await response.text()).toContain('Public content not found');
      }
      expect(await publish({ readableId: target.readableId })).toBe(targetId);
      await readSource(targetId);
      await transition({
        ownerId: 'owner-a',
        resourceType: 'page',
        action: 'unpublish',
        readableId: source.readableId,
      });
      for (const markdown of [false, true]) {
        const response = await request({ id: targetId, markdown });
        expect(response.status).toBe(StatusMap.OK);
        const body = await response.text();
        expect(body).toContain('Back to introduction');
        expect(body).not.toContain(sourceId);
      }
    },
  );
});

test('private, foreign, unknown, withdrawn and archived page identifiers are indistinguishable and there is no history route', async () => {
  await withPublicResources(async ({ create, publish, request, transition, database, app }) => {
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
        expect(await response.text()).toContain('Public content not found');
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

test('archived, foreign and unindexed page targets reveal no destination or metadata', async () => {
  await withPublicResources(async ({ create, publish, request, database }) => {
    const target = await create({ markdown: '# Hidden identity\n\nHidden body.' });
    const targetId = await publish({ readableId: target.readableId });
    const source = await create({
      markdown: `# Independent source\n\n[Authored label](context-use://page/${target.readableId}#private-fragment "Hidden tooltip")`,
    });
    await database`update "knowledge_page" set "archived_at" = ${NOW} where "id" = ${target.id}`;
    const sourceId = await publish({ readableId: source.readableId });
    async function expectPlainText() {
      for (const markdown of [false, true]) {
        const response = await request({ id: sourceId, markdown });
        expect(response.status).toBe(StatusMap.OK);
        const body = await response.text();
        expect(body).toContain('Authored label');
        for (const hidden of [
          targetId,
          target.id,
          target.readableId,
          'Hidden identity',
          'Hidden body',
          'Hidden tooltip',
          'private-fragment',
          'context-use://',
        ]) {
          expect(body).not.toContain(hidden);
        }
      }
    }
    await expectPlainText();
    await database`update "knowledge_page" set "archived_at" = null where "id" = ${target.id}`;
    // Corrupt the relationship boundary to prove public resolution retains owner scoping.
    await database.unsafe('pragma foreign_keys = off');
    await database`update "knowledge_page" set "owner_id" = 'owner-b' where "id" = ${target.id}`;
    await expectPlainText();
    await database`update "knowledge_page" set "owner_id" = 'owner-a' where "id" = ${target.id}`;
    await database.unsafe('pragma foreign_keys = on');
    await database`delete from "knowledge_page_reference" where "target_page_id" = ${target.id}`;
    await expectPlainText();
  });
});

test('unavailable non-page dependencies and missing relationship rows fail closed', async () => {
  await withPublicResources(async ({ targets, create, publish, request, database }) => {
    const target = await targets();
    const page = await create({
      markdown: `# Required dependencies\n\n[page](context-use://page/${target.page.readableId}) [entity](context-use://entity/${target.entity.readableId}) [asset](context-use://asset/${target.asset.readableId})`,
    });
    const id = await publish({ readableId: page.readableId });
    for (const [table, publicId] of [
      ['entity', target.entityId],
      ['asset', target.assetId],
    ]) {
      // Simulate unavailable target data outside the guarded normal transitions.
      await database.unsafe(`update "${table}" set "published_at" = null where "public_id" = $1`, [
        publicId!,
      ]);
      for (const markdown of [false, true]) {
        expect((await request({ id: id, ...{ markdown } })).status).toBe(StatusMap['Not Found']);
      }
      await database.unsafe(`update "${table}" set "published_at" = $1 where "public_id" = $2`, [
        NOW,
        publicId!,
      ]);
      expect((await request({ id: id })).status).toBe(StatusMap.OK);
    }
    await database`delete from "knowledge_page_entity_mention" where "target_entity_id" = ${target.entity.id}`;
    for (const markdown of [false, true]) {
      expect((await request({ id: id, ...{ markdown } })).status).toBe(StatusMap['Not Found']);
    }
  });
});

test('cross-owner publication and dependency joins cannot expose another owner through a public page', async () => {
  await withPublicResources(async ({ targets, create, publish, request, database }) => {
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
  await withPublicResources(async ({ create, publish, update, request, resources, storage }) => {
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

test('unavailable non-page targets and malformed page references in verified revision content fail closed', async () => {
  await withPublicResources(async ({ create, publish, request, resources, storage, database }) => {
    const page = await create({ markdown: '# Approved\n\nContent.' });
    const id = await publish({ readableId: page.readableId });
    const stored = (await resources.findPage({ publicId: id }))!;
    for (const address of [
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
        expect(await response.text()).toContain('Public content not found');
      }
    }
  });
});

test('publication previews match the selected public content and resolve live public destinations', async () => {
  await withPublicResources(
    async ({ targets, create, update, publish, service, transition, database }) => {
      const target = await targets();
      const privatePage = await create({ markdown: '# Private destination\n\nSecret body' });
      const page = await create({
        markdown: `# Review me

[Private **label**](context-use://page/${privatePage.readableId}#secret "Secret tooltip")

[Public section](context-use://page/${target.page.readableId}#evidence)

[Person](context-use://entity/${target.entity.readableId})

![Chart](context-use://asset/${target.asset.readableId})

[Website](https://example.com) <!-- hidden comment -->`,
      });
      const previewInput = { ownerId: 'owner-a', readableId: page.readableId, revisionNumber: 1 };
      const preview = await service.pagePreview(previewInput);
      expect(preview).not.toBeNull();
      expect(preview!.markdown).toContain('Private **label**');
      expect(preview!.markdown).not.toContain(privatePage.readableId);
      expect(preview!.markdown).not.toContain('Secret tooltip');
      expect(preview!.markdown).not.toContain('hidden comment');
      expect(preview!.markdown).toContain(`/public/pages/${target.pageId}#evidence`);
      expect(preview!.markdown).toContain(`/public/entities/${target.entityId}`);
      expect(preview!.markdown).toContain(`/public/assets/${target.assetId}`);
      expect(preview!.markdown).toContain('https://example.com');
      const id = await publish({ readableId: page.readableId });
      expect(await service.pageContent({ publicId: id })).toEqual(preview);
      await update({
        readableId: page.readableId,
        markdown: '# Later draft\n\nUnreviewed content',
      });
      expect(await service.pagePreview(previewInput)).toEqual(preview);
      await transition({
        ownerId: 'owner-a',
        resourceType: 'page',
        readableId: target.page.readableId,
        action: 'unpublish',
      });
      const withdrawn = await service.pagePreview(previewInput);
      expect(withdrawn!.markdown).not.toContain(target.pageId);
      expect(withdrawn!.markdown).toContain('Public section');
      expect(await service.pageContent({ publicId: id })).toEqual(withdrawn);
      await database`update "entity" set "published_at" = null where "public_id" = ${target.entityId}`;
      expect(await service.pagePreview(previewInput)).toBeNull();
    },
  );
});

test('first-publication self references remain navigable inside the preview', async () => {
  await withPublicResources(async ({ create, update, service, publications }) => {
    const page = await create({ markdown: '# Self reference\n\nIntroduction.' });
    await update({
      readableId: page.readableId,
      markdown: `# Self reference

[Top](context-use://page/${page.readableId}) and [Section](context-use://page/${page.readableId}#section)

## Section`,
    });
    const preview = await service.pagePreview({
      ownerId: 'owner-a',
      readableId: page.readableId,
      revisionNumber: 2,
    });
    expect(preview!.markdown).toContain('[Top](#)');
    expect(preview!.markdown).toContain('[Section](#section)');
    expect(
      await publications.pageStatus({ ownerId: 'owner-a', readableId: page.readableId }),
    ).toEqual({ publicId: null, publishedAt: null, publishedRevisionNumber: null });
  });
});
