import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StatusMap } from 'elysia';
import type { AssetFaces } from '#models/faces/model.ts';

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
  const images = (await (await request({ path: '/api/entities/steve-jobs/images' })).json()) as {
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
      (file) => file === 'app.db' || file.startsWith('objects/') || file.startsWith('face-crops/'),
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
  child.kill('SIGTERM');
  assert.equal(await child.exited, 0);
  assert.deepEqual(await readdir(temporary), []);
  console.log(
    'Compiled demo: precomputed faces and crops, anonymous browsing, write denial, personal-data isolation and cleanup passed.',
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
