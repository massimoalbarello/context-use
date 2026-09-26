import { expect, test } from 'bun:test';
import { StatusMap } from 'elysia';
import { CHANGE, NOW, PNG, withPublicResources } from './fixture.ts';

type Fixture = Parameters<Parameters<typeof withPublicResources>[0]>[0];

async function createEntity({
  fixture,
  ownerId = 'owner-a',
}: {
  fixture: Fixture;
  ownerId?: string;
}) {
  const result = await fixture.entities.create({
    id: Bun.randomUUIDv7(),
    ownerId,
    readableId: `private-entity-${ownerId}`,
    name: 'Ada Lovelace',
    description: 'Mathematician and writer.\nNotes on the Analytical Engine.',
    entityType: 'person',
    createdAt: NOW,
    change: CHANGE,
  });
  if (result.state !== 'created') {
    throw new Error('Missing entity');
  }
  return result.entity;
}

async function createPortrait({
  fixture,
  bytes = PNG,
}: {
  fixture: Fixture;
  bytes?: Buffer<ArrayBuffer>;
}) {
  const result = await fixture.assets.create({
    ownerId: 'owner-a',
    name: 'Private portrait metadata',
    allowDuplicate: true,
    file: new Blob([bytes]),
    change: CHANGE,
  });
  if (result.state !== 'created') {
    throw new Error('Missing image');
  }
  return result.asset;
}

function request({ fixture, id, cookie }: { fixture: Fixture; id: string; cookie?: string }) {
  return fixture.app.handle(
    new Request(`http://localhost/public/entities/${encodeURIComponent(id)}`, {
      headers: cookie ? { cookie } : {},
    }),
  );
}

test('live public identity uses only the approved current image and safely escaped intended fields', async () => {
  await withPublicResources(async (fixture) => {
    const { entities, transition, service, resources } = fixture;
    const entity = await createEntity({ fixture });
    const image = await createPortrait({ fixture });
    expect(
      (
        await entities.setImage({
          ownerId: 'owner-a',
          readableId: entity.readableId,
          assetId: image.id,
          updatedAt: NOW,
          change: CHANGE,
        })
      ).state,
    ).toBe('updated');
    const id = await transition({
      ownerId: 'owner-a',
      resourceType: 'entity',
      action: 'publish',
      readableId: entity.readableId,
    });
    const imageId = (await fixture.publications.assetStatus({
      ownerId: 'owner-a',
      readableId: image.readableId,
    }))!.publicId;
    expect(id).not.toBe(entity.id);
    expect(id).not.toBe(entity.readableId);
    const content = {
      modifiedAt: NOW,
      name: entity.name,
      description: entity.description,
      entityType: 'person' as const,
      imagePublicId: imageId,
      pages: [],
    };
    expect(await resources.findEntity({ publicId: id })).toEqual(content);
    expect(await service.entityContent({ publicId: id })).toEqual(content);
    const response = await request({ fixture, id });
    const body = await response.text();
    expect(response.status).toBe(StatusMap.OK);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(body).toContain('<h1>Ada Lovelace</h1>');
    expect(body).toContain('href="https://github.com/massimoalbarello/context-use"');
    expect(body).toContain('24 September 2026');
    expect(body).toContain('Person');
    expect(body).toContain('No public pages mention this entity yet.');
    expect(body).toContain(`src="/public/assets/${imageId}"`);
    const portrait = await fixture.app.handle(
      new Request(`http://localhost/public/assets/${imageId}`),
    );
    expect(new Uint8Array(await portrait.arrayBuffer())).toEqual(PNG);
    for (const value of [
      entity.id,
      entity.readableId,
      image.id,
      image.readableId,
      'owner-a',
      image.name,
      'imageAssetId',
      'storageKey',
      'isSelf',
      'updatedAt',
      'depicts',
      'faces',
      'Private author name',
      'revisionNumber',
      '/api/',
    ]) {
      expect(body).not.toContain(value);
    }
    const withCookie = await request({
      fixture,
      id,
      cookie: 'better-auth.session_token=owner-session',
    });
    expect([...withCookie.headers]).toEqual([...response.headers]);
    expect(await withCookie.text()).toBe(body);
    await entities.update({
      ownerId: 'owner-a',
      readableId: entity.readableId,
      name: 'Live <script>alert(1)</script> & name',
      description: '<img src="/api/private" onerror="alert(1)">\n[link](javascript:alert(1))',
      entityType: 'organization',
      updatedAt: '2026-09-25T10:00:00.000Z',
      change: CHANGE,
    });
    const edited = await (await request({ fixture, id })).text();
    expect(edited).toContain('<h1>Live &lt;script&gt;alert(1)&lt;/script&gt; &amp; name</h1>');
    expect(edited).toContain(
      '&lt;img src=&quot;/api/private&quot; onerror=&quot;alert(1)&quot;&gt;',
    );
    expect(edited).toContain('[link](javascript:alert(1))');
    expect(edited).toContain('Organization');
    expect(edited).not.toContain('<script>');
    expect(edited).not.toContain('<img src="/api');
    expect(edited).not.toContain('Ada Lovelace');
    const replacement = await createPortrait({
      fixture,
      bytes: Buffer.concat([PNG, Buffer.from('replacement')]),
    });
    expect(
      (
        await entities.setImage({
          ownerId: 'owner-a',
          readableId: entity.readableId,
          assetId: replacement.id,
          updatedAt: NOW,
          change: CHANGE,
        })
      ).state,
    ).toBe('image_not_public');
    const replacementId = await transition({
      ownerId: 'owner-a',
      resourceType: 'asset',
      action: 'publish',
      readableId: replacement.readableId,
    });
    expect(
      (
        await entities.setImage({
          ownerId: 'owner-a',
          readableId: entity.readableId,
          assetId: replacement.id,
          updatedAt: NOW,
          change: CHANGE,
        })
      ).state,
    ).toBe('updated');
    const replaced = await (await request({ fixture, id })).text();
    expect(replaced).toContain(`src="/public/assets/${replacementId}"`);
    expect(replaced).not.toContain(imageId!);
    await entities.removeImage({
      ownerId: 'owner-a',
      readableId: entity.readableId,
      updatedAt: NOW,
      change: CHANGE,
    });
    expect(await (await request({ fixture, id })).text()).not.toContain('<img');
  });
});

test('the mention index follows exact public revisions and public titles through private edits, replacement and withdrawal', async () => {
  await withPublicResources(async (fixture) => {
    const { create, update, publish, transition, resources, publications } = fixture;
    const entity = await createEntity({ fixture });
    const id = await transition({
      ownerId: 'owner-a',
      resourceType: 'entity',
      action: 'publish',
      readableId: entity.readableId,
    });
    const mention = `[Ada](context-use://entity/${entity.readableId})`;
    const first = await create({ markdown: `# B public title\n\n${mention} and ${mention}.` });
    const firstId = await publish({ readableId: first.readableId });
    const second = await create({ markdown: '# C public title\n\nNo mention.' });
    const secondId = await publish({ readableId: second.readableId });
    const third = await create({ markdown: `# A public title\n\n${mention}` });
    const thirdId = await publish({ readableId: third.readableId });
    const before = await (await request({ fixture, id })).text();
    expect((await resources.findEntity({ publicId: id }))?.pages).toEqual([
      { publicId: thirdId, title: 'A public title' },
      { publicId: firstId, title: 'B public title' },
    ]);
    expect(before.match(new RegExp(`href="/public/pages/${firstId}"`, 'g'))).toHaveLength(1);
    expect(before).not.toContain(secondId);
    expect(before).not.toContain(first.readableId);
    const firstDraft = await update({
      readableId: first.readableId,
      markdown: '# Z secret draft title\n\nMention removed privately.',
    });
    const secondDraft = await update({
      readableId: second.readableId,
      markdown: `# A secret added mention\n\n${mention}`,
    });
    await create({ markdown: `# 000 private new page\n\n${mention}` });
    expect(await (await request({ fixture, id })).text()).toBe(before);
    const withdraw = {
      ownerId: 'owner-a',
      resourceType: 'entity' as const,
      action: 'unpublish' as const,
      readableId: entity.readableId,
    };
    const blocked = (await publications.prepare(withdraw))!;
    expect(blocked.blockers.map((blocker) => blocker.resource.readableId).sort()).toEqual(
      [first.readableId, third.readableId].sort(),
    );
    expect(
      (
        await publications.execute({
          ...withdraw,
          expectedState: blocked.expectedState,
          publishedAt: NOW,
        })
      ).state,
    ).toBe('blocked');
    expect((await request({ fixture, id })).status).toBe(StatusMap.OK);
    expect(
      await publish({ readableId: first.readableId, revisionNumber: firstDraft.revisionNumber }),
    ).toBe(firstId);
    expect(
      await publish({ readableId: second.readableId, revisionNumber: secondDraft.revisionNumber }),
    ).toBe(secondId);
    expect((await resources.findEntity({ publicId: id }))?.pages).toEqual([
      { publicId: thirdId, title: 'A public title' },
      { publicId: secondId, title: 'A secret added mention' },
    ]);
    for (const page of [second, third]) {
      await transition({
        ownerId: 'owner-a',
        resourceType: 'page',
        action: 'unpublish',
        readableId: page.readableId,
      });
    }
    expect(await (await request({ fixture, id })).text()).toContain(
      'No public pages mention this entity yet.',
    );
    expect(await transition(withdraw)).toBe(id);
    expect((await request({ fixture, id })).status).toBe(StatusMap['Not Found']);
    expect(await transition({ ...withdraw, action: 'publish' })).toBe(id);
    expect((await resources.findEntity({ publicId: id }))?.pages).toEqual([]);
  });
});

test('unknown, private, foreign private, withdrawn, archived and mismatched entities share the same 404 without extra public routes', async () => {
  await withPublicResources(async (fixture) => {
    const entity = await createEntity({ fixture });
    const foreign = await createEntity({ fixture, ownerId: 'owner-b' });
    const operation = {
      ownerId: 'owner-a',
      resourceType: 'entity' as const,
      readableId: entity.readableId,
    };
    const id = await fixture.transition({ ...operation, action: 'publish' });
    for (const candidate of [
      entity.id,
      entity.readableId,
      foreign.id,
      foreign.readableId,
      'entity_unknown',
      'invalid!',
    ]) {
      for (const cookie of [undefined, 'better-auth.session_token=owner-session']) {
        const response = await request({ fixture, id: candidate, cookie });
        expect(response.status).toBe(StatusMap['Not Found']);
        expect(await response.text()).toContain('Public content not found');
      }
    }
    await fixture.transition({ ...operation, action: 'unpublish' });
    for (const cookie of [undefined, 'better-auth.session_token=owner-session']) {
      const response = await request({ fixture, id, cookie });
      expect(response.status).toBe(StatusMap['Not Found']);
      expect(await response.text()).toContain('Public content not found');
    }
    await fixture.transition({ ...operation, action: 'publish' });
    for (const path of ['', '?q=Ada', `/${id}/history`, `/${id}/revisions`, `/${id}/json`]) {
      expect(
        (await fixture.app.handle(new Request(`http://localhost/public/entities${path}`))).status,
      ).toBe(StatusMap['Not Found']);
    }
    const { database } = fixture;
    await database`update "entity" set "archived_at" = ${NOW} where "id" = ${entity.id}`;
    expect((await request({ fixture, id })).status).toBe(StatusMap['Not Found']);
  });
});

test('missing, private, archived, unsafe and cross-owner current portraits fail closed', async () => {
  await withPublicResources(async (fixture) => {
    const entity = await createEntity({ fixture });
    const image = await createPortrait({ fixture });
    await fixture.entities.setImage({
      ownerId: 'owner-a',
      readableId: entity.readableId,
      assetId: image.id,
      updatedAt: NOW,
      change: CHANGE,
    });
    const id = await fixture.transition({
      ownerId: 'owner-a',
      resourceType: 'entity',
      action: 'publish',
      readableId: entity.readableId,
    });
    const { database } = fixture;
    await database`update "asset" set "published_at" = null where "id" = ${image.id}`;
    expect((await request({ fixture, id })).status).toBe(StatusMap['Not Found']);
    await database`update "asset" set "published_at" = ${NOW} where "id" = ${image.id}`;
    await database`update "asset" set "archived_at" = ${NOW} where "id" = ${image.id}`;
    expect((await request({ fixture, id })).status).toBe(StatusMap['Not Found']);
    await database`update "asset" set "archived_at" = null, "media_type" = 'text/html' where "id" = ${image.id}`;
    expect((await request({ fixture, id })).status).toBe(StatusMap['Not Found']);
    await database`update "asset" set "media_type" = 'image/png' where "id" = ${image.id}`;
    await database.unsafe('pragma foreign_keys = off');
    await database`update "asset" set "owner_id" = 'owner-b' where "id" = ${image.id}`;
    expect((await request({ fixture, id })).status).toBe(StatusMap['Not Found']);
    await database`update "entity" set "image_asset_id" = 'missing-image' where "id" = ${entity.id}`;
    expect((await request({ fixture, id })).status).toBe(StatusMap['Not Found']);
    await database.unsafe('pragma foreign_keys = on');
  });
});

test('the index excludes archived pages and inconsistent owner or selected revision joins', async () => {
  await withPublicResources(async (fixture) => {
    const entity = await createEntity({ fixture });
    const id = await fixture.transition({
      ownerId: 'owner-a',
      resourceType: 'entity',
      action: 'publish',
      readableId: entity.readableId,
    });
    const page = await fixture.create({
      markdown: `# Public <script>title</script> & name\n\n[entity](context-use://entity/${entity.readableId})`,
    });
    const pageId = await fixture.publish({ readableId: page.readableId });
    expect((await fixture.resources.findEntity({ publicId: id }))?.pages).toHaveLength(1);
    const html = await (await request({ fixture, id })).text();
    expect(html).not.toContain('<script>');
    expect(html).toContain('Public title &amp; name');
    const { database } = fixture;
    await database`update "knowledge_page" set "archived_at" = ${NOW} where "id" = ${page.id}`;
    expect((await fixture.resources.findEntity({ publicId: id }))?.pages).toEqual([]);
    await database`update "knowledge_page" set "archived_at" = null where "id" = ${page.id}`;
    await database.unsafe('pragma foreign_keys = off');
    for (const table of [
      'knowledge_page_revision',
      'knowledge_page',
      'knowledge_page_entity_mention',
    ]) {
      await database.unsafe(`update "${table}" set "owner_id" = 'owner-b'`);
      expect((await fixture.resources.findEntity({ publicId: id }))?.pages).toEqual([]);
      await database.unsafe(`update "${table}" set "owner_id" = 'owner-a'`);
      expect((await fixture.resources.findEntity({ publicId: id }))?.pages).toHaveLength(1);
    }
    const other = await fixture.create({
      markdown: '# Foreign selected revision\n\nOther content.',
    });
    await database`update "knowledge_page" set "published_revision_id" = (select "current_revision_id" from "knowledge_page" where "id" = ${other.id}) where "public_id" = ${pageId}`;
    expect((await fixture.resources.findEntity({ publicId: id }))?.pages).toEqual([]);
    await database.unsafe('pragma foreign_keys = on');
  });
});
