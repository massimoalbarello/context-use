import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AssetFaces } from '@repo/backend/models/faces/model';
import { startBinary } from '@repo/pack-utils/binary-check';
import { StatusMap } from 'elysia';

const TEST_TIMEOUT_MS = 40_000;

test(
  'compiled demo preserves its embedded assets and isolation',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'context-use-demo-binary-test-'));
    const personal = join(root, 'personal');
    const temporary = join(root, 'temporary');
    await mkdir(personal);
    await mkdir(temporary);
    const sentinel = 'PRIVATE INSTANCE SENTINEL: never read or modify this';
    await Bun.write(join(personal, 'app.db'), sentinel);
    try {
      await using binary = await startBinary({
        executable: join(import.meta.dir, '../dist/context-use-demo'),
        cwd: root,
        env: { DATA_FOLDER: personal, TMPDIR: temporary },
      });
      const { request } = binary;
      const page = await request({ path: '/pages/bringing-our-music-work-into-phones' });
      assert.equal(page.status, StatusMap.OK);
      const html = await page.text();
      assert.match(html, /<html/);
      assert.match(html, /Read-only demo/);
      const entry = html.match(/<script[^>]+src="([^"]+)"/);
      assert.ok(entry);
      assert.equal((await request({ path: entry[1]! })).status, StatusMap.OK);
      const profile = await request({ path: '/api/profile' });
      assert.equal(profile.status, StatusMap.OK);
      assert.match(await profile.text(), /Steve Jobs/);
      assert.equal(profile.headers.has('set-cookie'), false);
      const picture = await request({ path: '/api/assets/steve-presenting-iphone/content' });
      assert.equal(picture.status, StatusMap.OK);
      assert.match(picture.headers.get('content-type') ?? '', /^image\//);
      const faces = (await (
        await request({ path: '/api/assets/steve-presenting-iphone/faces' })
      ).json()) as AssetFaces;
      assert.equal(faces.state, 'ready');
      assert.equal(faces.outdated, false);
      const steve = faces.faces.find((face) => face.entity?.readableId === 'steve-jobs');
      assert.ok(steve, 'Seeded photo should recognize Steve Jobs from his portrait');
      const crop = await request({
        path: `/api/assets/steve-presenting-iphone/faces/${steve.readableId}/crop`,
      });
      assert.equal(crop.status, StatusMap.OK);
      assert.match(crop.headers.get('content-type') ?? '', /^image\/jpeg/);
      assert.ok((await crop.arrayBuffer()).byteLength > 0);
      const images = (await (
        await request({ path: '/api/entities/steve-jobs/images' })
      ).json()) as {
        items: { readableId: string }[];
      };
      assert.ok(images.items.some((image) => image.readableId === 'steve-presenting-iphone'));
      const extracted = await readdir(temporary);
      assert.equal(extracted.length, 1);
      const files = Array.from(
        new Bun.Glob('**/*').scanSync({ cwd: join(temporary, extracted[0]!), onlyFiles: true }),
      );
      assert.ok(files.some((file) => file.startsWith('face-crops/')));
      assert.ok(
        files.every(
          (file) =>
            file === 'app.db' || file.startsWith('objects/') || file.startsWith('face-crops/'),
        ),
        'Snapshot must not include inference binaries or models',
      );
      for (const path of [
        '/api/pages',
        '/api/profile',
        '/api/auth/get-session',
        '/api/records/batch',
        '/mcp',
        '/',
      ]) {
        const response = await request({ path, method: 'POST', body: '{}' });
        assert.equal(response.status, StatusMap.Forbidden, `Write accepted: ${path}`);
        assert.match(await response.text(), /read-only/);
      }
      for (const path of [
        '/api/auth/sign-out',
        '/api/auth/passkey/generate-register-options',
        '/api/syncs',
        '/mcp/asset-transfers/token',
      ]) {
        assert.equal((await request({ path })).status, StatusMap.Forbidden, path);
      }
      for (const path of [
        '/pages/new',
        '/entities/new',
        '/assets/new',
        '/settings',
        '/settings/syncs',
      ]) {
        assert.match(await (await request({ path })).text(), /Read-only demo/);
      }
      assert.equal(await Bun.file(join(personal, 'app.db')).text(), sentinel);
      assert.deepEqual(await readdir(personal), ['app.db']);
      await binary.stop();
      assert.deepEqual(await readdir(temporary), []);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  TEST_TIMEOUT_MS,
);
