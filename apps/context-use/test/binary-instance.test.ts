import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startBinary } from '@repo/build-tools/binary-check';

const TEST_TIMEOUT_MS = 40_000;
const OK = 200;
const UNAUTHORIZED = 401;

test(
  'compiled instance migrates its own data and embeds only its dashboard assets',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'context-use-instance-binary-test-'));
    try {
      await using binary = await startBinary({
        executable: join(import.meta.dir, '../dist/context-use'),
        cwd: directory,
        env: { DATA_FOLDER: join(directory, 'data') },
      });
      expect((await binary.request({ path: '/api/health' })).status).toBe(OK);
      expect((await binary.request({ path: '/api/profile' })).status).toBe(UNAUTHORIZED);
      const html = await (await binary.request({ path: '/login' })).text();
      expect(html).toContain('<div id="app"></div>');
      expect(html).not.toContain('Read-only demo');
      const assets = join(import.meta.dir, '../dist/instance/public');
      for await (const path of new Bun.Glob('**/*').scan({ cwd: assets, onlyFiles: true })) {
        const response = await binary.request({ path: `/${path}` });
        expect(response.status, path).toBe(OK);
        expect(await response.bytes(), path).toEqual(await Bun.file(join(assets, path)).bytes());
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
  TEST_TIMEOUT_MS,
);
