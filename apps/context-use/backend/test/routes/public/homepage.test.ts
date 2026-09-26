import { expect, test } from 'bun:test';
import { StatusMap } from 'elysia';
import { PublicSiteRepository } from '#backend/repositories/public-site/repository.ts';
import { withPublicResources } from './fixture.ts';

test('homepage is empty by default and serves only the selected owner’s approved revision', async () => {
  await withPublicResources(async ({ app, database, create, publish, update, transition }) => {
    const site = new PublicSiteRepository(database);
    const read = (cookie?: string) =>
      app.handle(
        new Request('http://localhost/public', {
          headers: cookie ? { cookie } : {},
        }),
      );
    expect(await (await read()).text()).toContain('Nothing published yet');
    const page = await create({ markdown: '# Welcome\n\nPublic introduction.' });
    const publicId = await publish({ readableId: page.readableId });
    await site.setHomepage({ ownerId: 'owner-a', readableId: page.readableId });
    const first = await read();
    expect(first.status).toBe(StatusMap.OK);
    const html = await first.text();
    expect(html).toContain('Public introduction.');
    expect(html).toContain(`/public/pages/${publicId}/markdown`);
    expect(first.headers.get('cache-control')).toBe('private, no-store');
    expect(first.headers.get('content-security-policy')).toContain("default-src 'none'");

    await update({ readableId: page.readableId, markdown: '# Secret draft\n\nPrivate edit.' });
    expect(await (await read('better-auth.session_token=some-owner-session')).text()).toBe(html);

    const other = await create({
      ownerId: 'owner-b',
      markdown: '# Other owner homepage\n\nPublished content.',
    });
    await transition({
      ownerId: 'owner-b',
      resourceType: 'page',
      readableId: other.readableId,
      action: 'publish',
      revisionNumber: 1,
    });
    await site.setHomepage({ ownerId: 'owner-b', readableId: other.readableId });
    expect(await (await read()).text()).toBe(html);
    await transition({
      ownerId: 'owner-a',
      resourceType: 'page',
      readableId: page.readableId,
      action: 'unpublish',
    });
    expect(await site.homepage({ ownerId: 'owner-a' })).toBeNull();
    expect(await (await read()).text()).toContain('Nothing published yet');
    expect(
      (await app.handle(new Request(`http://localhost/public/pages/${publicId}`))).status,
    ).toBe(StatusMap['Not Found']);
    await publish({ readableId: page.readableId });
    expect(await (await read()).text()).toContain('Nothing published yet');
  });
});

test('homepage selection is owner-scoped, atomic, unique, and limited to active public pages', async () => {
  await withPublicResources(async ({ database, create, publish }) => {
    const site = new PublicSiteRepository(database);
    const first = await create({ markdown: '# First\n\nPublished content.' });
    const second = await create({ markdown: '# Second\n\nPublished content.' });
    const privatePage = await create({ markdown: '# Private\n\nPublished content.' });
    const foreign = await create({
      ownerId: 'owner-b',
      markdown: '# Foreign\n\nPublished content.',
    });
    for (const page of [first, second]) {
      await publish({ readableId: page.readableId });
    }
    expect(await site.setHomepage({ ownerId: 'owner-a', readableId: first.readableId })).toBe(true);
    for (const readableId of [privatePage.readableId, foreign.readableId, 'missing']) {
      expect(await site.setHomepage({ ownerId: 'owner-a', readableId })).toBe(false);
      expect((await site.homepage({ ownerId: 'owner-a' }))?.readableId).toBe(first.readableId);
    }
    await expect(
      Promise.resolve(
        database`update "knowledge_page" set "public_homepage" = 1 where "id" = ${second.id}`,
      ),
    ).rejects.toThrow();
    await expect(
      Promise.resolve(
        database`update "knowledge_page" set "public_homepage" = 1 where "id" = ${privatePage.id}`,
      ),
    ).rejects.toThrow();
    await expect(
      Promise.resolve(
        database`update "knowledge_page" set "archived_at" = '2026-09-25' where "id" = ${first.id}`,
      ),
    ).rejects.toThrow();
    expect(await site.setHomepage({ ownerId: 'owner-a', readableId: second.readableId })).toBe(
      true,
    );
    expect((await site.homepage({ ownerId: 'owner-a' }))?.readableId).toBe(second.readableId);
    const selected = await database`select "id" from "knowledge_page" where "public_homepage" = 1`;
    expect(selected).toHaveLength(1);
    await site.setHomepage({ ownerId: 'owner-a', readableId: null });
    expect(await site.homepage({ ownerId: 'owner-a' })).toBeNull();
    const [publication] =
      await database`select "published_at" from "knowledge_page" where "id" = ${second.id}`;
    expect(publication.published_at).not.toBeNull();
  });
});

test('unpublishing requires a fresh review if the page becomes the homepage', async () => {
  await withPublicResources(async ({ database, create, publish, publications }) => {
    const page = await create({ markdown: '# Start here\n\nPublished content.' });
    await publish({ readableId: page.readableId });
    const input = {
      ownerId: 'owner-a',
      resourceType: 'page',
      readableId: page.readableId,
      action: 'unpublish',
    } as const;
    const before = (await publications.prepare(input))!;
    expect(before.pageRevision?.publicHomepage).toBe(false);
    const site = new PublicSiteRepository(database);
    await site.setHomepage({ ownerId: 'owner-a', readableId: page.readableId });
    const result = await publications.execute({
      ...input,
      expectedState: before.expectedState,
      publishedAt: '2026-09-25T10:00:00.000Z',
    });
    expect(result.state).toBe('state_changed');
    const review = (await publications.prepare(input))!;
    expect(review.pageRevision?.publicHomepage).toBe(true);
    expect((await site.homepage({ ownerId: 'owner-a' }))?.readableId).toBe(page.readableId);
  });
});
