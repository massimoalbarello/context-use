import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StatusMap } from 'elysia';

const START_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 5_000;
const root = await mkdtemp(join(tmpdir(), 'context-use-demo-binary-test-'));
const personal = join(root, 'personal');
const temporary = join(root, 'temporary');
await mkdir(personal);
await mkdir(temporary);
const sentinel = 'PRIVATE INSTANCE SENTINEL: never read or modify this';
await Bun.write(join(personal, 'app.db'), sentinel);
const child = Bun.spawn([join(import.meta.dir, 'dist/context-use-demo')], {
  cwd: root,
  env: { ...process.env, PORT: '0', DATA_FOLDER: personal, TMPDIR: temporary },
  stdout: 'pipe',
  stderr: 'inherit',
});

let startupTimer: ReturnType<typeof setTimeout>;
try {
  const address = await Promise.race([
    listeningAddress(child.stdout),
    // biome-ignore lint/complexity/useMaxParams: native Promise executor signature
    new Promise<never>((_resolve, reject) => {
      startupTimer = setTimeout(
        () => reject(new Error('Demo startup timed out')),
        START_TIMEOUT_MS,
      );
    }),
  ]).finally(() => clearTimeout(startupTimer));
  const request = ({ path, ...init }: RequestInit & { path: string }) =>
    fetch(new URL(path, address), {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  const page = await request({ path: '/pages/bringing-our-music-work-into-phones' });
  assert.equal(page.status, StatusMap.OK);
  const html = await page.text();
  assert.match(html, /<html/);
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
  for (const path of [
    '/api/pages',
    '/api/profile',
    '/api/auth/get-session',
    '/api/records/batch',
    '/mcp',
    '/',
  ]) {
    const response = await request({ path, method: 'POST', body: '{}' });
    assert.ok(
      response.status === StatusMap.Forbidden || response.status === StatusMap['Payload Too Large'],
      `Write accepted: ${path}`,
    );
  }
  for (const path of [
    '/api/auth/sign-out',
    '/api/auth/passkey/generate-register-options',
    '/api/syncs',
    '/mcp/asset-transfers/token',
    '/pages/new',
    '/settings',
  ]) {
    assert.equal((await request({ path })).status, StatusMap.Forbidden, path);
  }
  assert.equal(await Bun.file(join(personal, 'app.db')).text(), sentinel);
  assert.deepEqual(await readdir(personal), ['app.db']);
  child.kill('SIGTERM');
  assert.equal(await child.exited, 0);
  assert.deepEqual(await readdir(temporary), []);
  console.log(
    'Compiled demo: anonymous browsing, write denial, personal-data isolation and cleanup passed.',
  );
} finally {
  if (child.exitCode === null) {
    child.kill('SIGTERM');
    await child.exited;
  }
  await rm(root, { recursive: true, force: true });
}

async function listeningAddress(stdout: ReadableStream<Uint8Array>): Promise<URL> {
  let output = '';
  for await (const chunk of stdout) {
    output += new TextDecoder().decode(chunk);
    const match = output.match(/listening on (http:\/\/[^\s]+)/);
    if (match) {
      const url = new URL(match[1]!);
      url.hostname = '127.0.0.1';
      return url;
    }
  }
  throw new Error(`Demo exited before listening: ${output}`);
}
