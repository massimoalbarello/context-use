import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startBinary } from '@repo/build-tools/binary-check';

const OK = 200;
const NOT_FOUND = 404;
const METHOD_NOT_ALLOWED = 405;
const TEST_TIMEOUT_MS = 40_000;

test(
  'compiled landing preserves its embedded assets and isolation',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'context-use-landing-check-'));
    try {
      await using binary = await startBinary({
        executable: join(import.meta.dir, '../dist/context-use-landing'),
        cwd: directory,
      });
      const { request } = binary;
      const page = await request({ path: '/' });
      assert.equal(page.status, OK);
      assert.match(page.headers.get('content-type') ?? '', /^text\/html/);
      assert.equal(page.headers.get('cache-control'), 'no-cache');
      assert.match(await page.text(), /<title>Context Use<\/title>/);

      // Every emitted asset must survive compilation, including dynamically imported GPU chunks.
      const publicDirectory = join(import.meta.dir, '../dist/public');
      for await (const path of new Bun.Glob('**/*').scan({
        cwd: publicDirectory,
        onlyFiles: true,
      })) {
        const response = await request({ path: `/${path}` });
        const original = Bun.file(join(publicDirectory, path));
        assert.equal(response.status, OK, path);
        assert.equal(response.headers.get('content-type'), original.type, path);
        assert.deepEqual(await response.bytes(), await original.bytes(), path);
        if (path.startsWith('assets/')) {
          assert.match(response.headers.get('cache-control') ?? '', /immutable/);
        }
      }
      const head = await request({ path: '/', method: 'HEAD' });
      assert.equal(head.status, OK);
      assert.equal(await head.text(), '');
      for (const path of ['/assets/missing.js', '/api/profile', '/.env', '/unknown']) {
        assert.equal((await request({ path })).status, NOT_FOUND, path);
      }
      const post = await request({ path: '/', method: 'POST' });
      assert.equal(post.status, METHOD_NOT_ALLOWED);
      assert.equal(post.headers.get('allow'), 'GET, HEAD');
      await binary.stop();
      assert.deepEqual(await readdir(directory), []);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
  TEST_TIMEOUT_MS,
);
