import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startBinary } from '@repo/build-tools/binary-check';

const TEST_TIMEOUT_MS = 40_000;
const OK = 200;
const UNAUTHORIZED = 401;
const NOT_FOUND = 404;

test(
  'compiled instance migrates its own data and embeds only its dashboard assets',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'context-use-instance-binary-test-'));
    try {
      await using binary = await startBinary({
        executable: join(import.meta.dir, '../dist/context-use'),
        cwd: directory,
        env: {
          DATA_FOLDER: join(directory, 'data'),
          BASE_URL: 'https://notes.example.org',
          PUBLIC_SITE_NAME: 'Orchard Notes',
        },
      });
      expect((await binary.request({ path: '/api/health' })).status).toBe(OK);
      expect((await binary.request({ path: '/api/profile' })).status).toBe(UNAUTHORIZED);
      const publicHome = await binary.request({ path: '/', redirect: 'manual' });
      expect(publicHome.status).toBe(OK);
      expect(await publicHome.text()).toContain('Nothing published yet');
      const directoryHtml = await (await binary.request({ path: '/public/directory' })).text();
      expect(directoryHtml).toContain('<h1>Orchard Notes</h1>');
      expect(directoryHtml).toContain(
        'rel="canonical" href="https://notes.example.org/public/directory"',
      );
      expect(directoryHtml).toContain('property="og:site_name" content="Orchard Notes"');
      expect(directoryHtml).toContain('"@type":"WebSite"');
      expect(directoryHtml).toContain('"url":"https://notes.example.org/"');
      const llms = await (await binary.request({ path: '/llms.txt' })).text();
      expect(llms).toContain('# Orchard Notes');
      expect(llms).toContain('(https://notes.example.org/)');
      for (const path of [
        '/app/map',
        '/app/pages/example',
        '/app/settings/api-keys',
        '/app/mcp/authorize',
        '/app/settings/public-site',
      ]) {
        const response = await binary.request({ path });
        expect(response.status, path).toBe(OK);
        expect(await response.text()).toContain('<div id="app"></div>');
      }
      for (const path of [
        '/some-path-that-does-not-exist',
        '/app/settings/unknown',
        '/missing.js',
        '/assets/missing.js',
      ]) {
        const response = await binary.request({ path, headers: { accept: 'text/markdown' } });
        expect(response.status, path).toBe(NOT_FOUND);
        expect(response.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
        const markdown = await response.text();
        expect(markdown).toContain('This address is unavailable.');
        expect(markdown).toContain('/llms.txt');
      }
      const html = await (await binary.request({ path: '/app/login' })).text();
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
