import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startBinary } from '@repo/build-tools/binary-check';

const TEST_TIMEOUT_MS = 40_000;
const OK = 200;
const FOUND = 302;
const UNAUTHORIZED = 401;
const NOT_FOUND = 404;
const CRON_TIMEOUT_MS = 10_000;

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
      // Invoke the OS job as a fresh process with no host configuration or inherited cwd.
      const socket = join(directory, 'data/open-sync/sync.db.cron/worker.sock');
      const cronDirectory = join(directory, 'cron-cwd');
      await mkdir(cronDirectory);
      const cron = Bun.spawn(
        [
          join(import.meta.dir, '../dist/context-use'),
          `--cron-title=open-sync-${Buffer.from(socket).toString('base64url')}`,
        ],
        { cwd: cronDirectory, env: {}, stdout: 'pipe', stderr: 'pipe' },
      );
      const cronTimeout = setTimeout(() => cron.kill('SIGKILL'), CRON_TIMEOUT_MS);
      try {
        const [code, stdout, stderr] = await Promise.all([
          cron.exited,
          new Response(cron.stdout).text(),
          new Response(cron.stderr).text(),
        ]);
        expect(code, stderr).toBe(0);
        expect(stdout).toBe('');
        expect(await readdir(cronDirectory)).toEqual([]);
        expect((await binary.request({ path: '/api/health' })).status).toBe(OK);
      } finally {
        clearTimeout(cronTimeout);
        if (cron.exitCode === null) {
          cron.kill('SIGKILL');
        }
        await cron.exited;
      }
      expect((await binary.request({ path: '/api/profile' })).status).toBe(UNAUTHORIZED);
      const entry = await binary.request({ path: '/', redirect: 'manual' });
      expect(entry.status).toBe(FOUND);
      expect(entry.headers.get('location')).toBe('/app/login');
      const publicHome = await binary.request({ path: '/public', redirect: 'manual' });
      expect(publicHome.status).toBe(OK);
      const homeHtml = await publicHome.text();
      expect(homeHtml).toContain('Nothing published yet');
      expect(homeHtml).toContain('"@type":"WebSite"');
      expect(homeHtml).toContain('"name":"Orchard Notes"');
      expect(homeHtml).toContain('"url":"https://notes.example.org/public"');
      const directoryHtml = await (await binary.request({ path: '/public/directory' })).text();
      expect(directoryHtml).toContain('<h1>Orchard Notes</h1>');
      expect(directoryHtml).toContain(
        'rel="canonical" href="https://notes.example.org/public/directory"',
      );
      expect(directoryHtml).toContain('property="og:site_name" content="Orchard Notes"');
      expect(directoryHtml).not.toContain('application/ld+json');
      const llms = await (await binary.request({ path: '/llms.txt' })).text();
      expect(llms).toContain('# Orchard Notes');
      expect(llms).toContain('(https://notes.example.org/public)');
      for (const path of [
        '/app/map',
        '/app/pages/example',
        '/app/settings/api-keys',
        '/app/mcp/authorize',
        '/app/settings/public-site',
        '/app/settings/unknown',
      ]) {
        const response = await binary.request({ path });
        expect(response.status, path).toBe(OK);
        expect(await response.text()).toContain('<div id="app"></div>');
      }
      const viewerPath = '/public/assets/74075bf0-08db-4c1a-878a-97a1e2bbc405/preview';
      const viewer = await binary.request({ path: viewerPath, redirect: 'manual' });
      expect(viewer.status).toBe(OK);
      expect(viewer.headers.get('content-type')).toContain('text/html');
      const viewerPolicy = viewer.headers.get('content-security-policy') ?? '';
      expect(viewerPolicy).not.toContain("frame-ancestors 'none'");
      expect(viewerPolicy).not.toContain("script-src 'none'");
      expect(viewer.headers.get('x-frame-options')?.toUpperCase()).not.toBe('DENY');
      expect(await viewer.text()).toContain('<div id="app"></div>');
      const viewerHead = await binary.request({ path: viewerPath, method: 'HEAD' });
      expect(viewerHead.status).toBe(OK);
      expect(await viewerHead.text()).toBe('');
      expect((await binary.request({ path: viewerPath, method: 'POST' })).status).toBe(NOT_FOUND);
      expect((await binary.request({ path: '/public/assets/private-or-unknown' })).status).toBe(
        NOT_FOUND,
      );
      for (const path of [
        '/some-path-that-does-not-exist',
        '/missing.js',
        '/assets/missing.js',
        '/pdf-preview',
        '/pdf-preview/',
        '/pdf-preview/example',
        '/pdf-preview/example/extra',
        '/pdf-preview/missing.js',
        '/public/assets/example/preview/extra',
        '/public/assets/example/preview.js',
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
