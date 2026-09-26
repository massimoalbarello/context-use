import { expect, test } from 'bun:test';
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const repository = resolve(import.meta.dir, '../../..');
const backendPath = 'apps/context-use/backend';
const script = `${backendPath}/scripts/build-faces.ts`;
const EXECUTABLE_MODE = 0o755;
const READ_ONLY_MODE = 0o644;
const BUILD_TEST_TIMEOUT_MS = 30_000;

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'context-use-face-cache-'));
  const backend = join(root, backendPath);
  await mkdir(join(backend, 'native'), { recursive: true });
  await cp(join(repository, backendPath, 'native/faces'), join(backend, 'native/faces'), {
    recursive: true,
  });
  for (const path of [
    'scripts/build-faces.ts',
    'scripts/shared/build-assets.ts',
    'scripts/shared/build-target.ts',
    'scripts/shared/face-build-cache.ts',
  ]) {
    await mkdir(dirname(join(backend, path)), { recursive: true });
    await cp(join(repository, backendPath, path), join(backend, path));
  }
  const bin = join(root, 'bin');
  await mkdir(bin);
  await writeFile(
    join(bin, 'docker'),
    `#!${process.execPath}
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
if (process.env.FAIL_DOCKER === '1') process.exit(1);
if (Bun.argv[2] === 'info') process.exit(0);
const output = Bun.argv.find(value => value.startsWith('type=local,dest='));
if (!output) throw new Error('Missing native output directory');
const destination = output.slice('type=local,dest='.length);
await mkdir(destination, { recursive: true });
const binary = join(destination, 'face-analyzer');
await writeFile(binary, await Bun.file('${backendPath}/native/faces/main.cpp').text());
await chmod(binary, ${EXECUTABLE_MODE});
if (process.env.FAIL_AFTER_OUTPUT === '1') process.exit(1);
`,
  );
  await chmod(join(bin, 'docker'), EXECUTABLE_MODE);
  const run = async (input: { args?: string[]; env?: Record<string, string> } = {}) => {
    const child = Bun.spawn([process.execPath, script, ...(input.args ?? [])], {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        BUILD_TARGET: 'bun-linux-x64',
        ...input.env,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return { code, stdout, stderr };
  };
  const info = async () => {
    const result = await run({ args: ['--cache-info'] });
    expect(result.code, result.stderr).toBe(0);
    return JSON.parse(result.stdout) as { key: string; directory: string };
  };
  return { root, backend, run, info, close: () => rm(root, { recursive: true, force: true }) };
}

test('native cache keys track the build recipe independently of app and browser changes', async () => {
  const app = await fixture();
  try {
    const initial = await app.info();
    expect(initial.key).toStartWith('face-engine-linux-amd64-');
    for (const path of [
      'packages/browser-testing/src/auth.ts',
      'apps/context-use/frontend/src/routes/app.map.tsx',
      'package.json',
      'bun.lock',
    ]) {
      await mkdir(dirname(join(app.root, path)), { recursive: true });
      await writeFile(join(app.root, path), 'unrelated change');
    }
    expect(await app.info()).toEqual(initial);

    let previous = initial.key;
    for (const path of [
      'native/faces/main.cpp',
      'native/faces/CMakeLists.txt',
      'native/faces/Dockerfile',
      'scripts/build-faces.ts',
    ]) {
      const file = join(app.backend, path);
      await writeFile(file, `${await readFile(file, 'utf8')}\n// Changed build input.\n`);
      const next = await app.info();
      expect(next.key).not.toBe(previous);
      previous = next.key;
    }
    for (const target of ['host', 'bun-windows-x64']) {
      const result = await app.run({ args: ['--cache-info'], env: { BUILD_TARGET: target } });
      expect(result.code).not.toBe(0);
    }
  } finally {
    await app.close();
  }
});

test(
  'builds reuse only complete, executable native artifacts matching the current inputs',
  async () => {
    const app = await fixture();
    try {
      const { directory } = await app.info();
      const binary = join(directory, 'face-analyzer');
      const manifest = join(directory, 'build-fingerprint');
      const cold = await app.run();
      expect(cold.code, cold.stderr).toBe(0);
      const original = await readFile(binary, 'utf8');
      const warm = await app.run({ env: { FAIL_DOCKER: '1' } });
      expect(warm.code, warm.stderr).toBe(0);
      expect(warm.stdout).toContain('Reusing cached Linux face recognition engine');
      expect(await readFile(binary, 'utf8')).toBe(original);

      for (const invalidate of [
        () => writeFile(binary, 'corrupted artifact'),
        () => chmod(binary, READ_ONLY_MODE),
        () => rm(binary),
        () => writeFile(manifest, 'corrupted fingerprint'),
        () => rm(manifest),
      ]) {
        await invalidate();
        expect((await app.run({ env: { FAIL_DOCKER: '1' } })).code).not.toBe(0);
        const rebuilt = await app.run();
        expect(rebuilt.code, rebuilt.stderr).toBe(0);
        expect(await readFile(binary, 'utf8')).toBe(original);
      }

      const source = join(app.backend, 'native/faces/main.cpp');
      await writeFile(source, `${original}\n// Updated native source.\n`);
      expect((await app.run({ env: { FAIL_AFTER_OUTPUT: '1' } })).code).not.toBe(0);
      expect((await app.run({ env: { FAIL_DOCKER: '1' } })).code).not.toBe(0);
      const rebuilt = await app.run();
      expect(rebuilt.code, rebuilt.stderr).toBe(0);
      expect(await readFile(binary, 'utf8')).toBe(await readFile(source, 'utf8'));
      expect((await app.run({ env: { FAIL_DOCKER: '1' } })).code).toBe(0);
    } finally {
      await app.close();
    }
  },
  BUILD_TEST_TIMEOUT_MS,
);
