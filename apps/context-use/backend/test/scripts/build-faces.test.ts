import { expect, test } from 'bun:test';
import { chmod, cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const backend = resolve(import.meta.dir, '../..');
const EXECUTABLE_MODE = 0o755;
const SLOW_COMPILER_MS = 16_000;
const SLOW_BUILD_TIMEOUT_MS = 30_000;

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'context-use-dev-build-test-'));
  const app = join(root, 'apps/context-use/backend');
  const bin = join(root, 'bin');
  await mkdir(join(app, 'scripts/shared'), { recursive: true });
  await mkdir(bin);
  for (const path of ['build-faces.ts', 'shared/build-target.ts', 'shared/build-assets.ts']) {
    await cp(join(backend, 'scripts', path), join(app, 'scripts', path));
  }
  // Only the slow external compiler is substituted; the actual build script run in Bun.
  await Bun.write(
    join(bin, 'cmake'),
    `#!${process.execPath}
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
console.log('Performing Test HAVE_C_WNON_VIRTUAL_DTOR - Failed');
if (process.argv.includes('--build')) {
  console.log('[ 20%] Building a compiler dependency');
  console.error('Compiler diagnostic: checking optional features');
  if (process.env.TEST_COMPILER_SLOW) await Bun.sleep(${SLOW_COMPILER_MS});
  if (process.env.TEST_COMPILER_FAILURE) {
    for (let i = 0; i < 150; i++) console.log('Compiler progress ' + i);
    console.error('fatal error: fixture dependency is missing');
    process.exit(7);
  }
  const output = join(process.argv[process.argv.indexOf('--build') + 1], 'runtime');
  await mkdir(output, { recursive: true });
  await Bun.write(join(output, 'face-analyzer'), 'compiled engine');
}
`,
  );
  await chmod(join(bin, 'cmake'), EXECUTABLE_MODE);
  return {
    root,
    app,
    engine: join(app, '.cache/face-engine-host/face-analyzer'),
    log: join(root, '.cache/face-build-host/build.log'),
    run: async ({
      command,
      fail = false,
      slow = false,
    }: {
      command: string[];
      fail?: boolean;
      slow?: boolean;
    }) => {
      const child = Bun.spawn([process.execPath, 'run', ...command], {
        cwd: app,
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          TEST_COMPILER_FAILURE: fail ? '1' : undefined,
          TEST_COMPILER_SLOW: slow ? '1' : undefined,
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
    },
    close: () => rm(root, { recursive: true, force: true }),
  };
}

test('the optional native build installs the local engine', async () => {
  const context = await fixture();
  try {
    const result = await context.run({ command: ['scripts/build-faces.ts', '--host'] });
    expect(result.code).toBe(0);
    expect(await Bun.file(context.engine).text()).toBe('compiled engine');
    expect(result.stdout).toContain('first build can take several minutes');
    expect(result.stdout).toContain('Checking build configuration');
    expect(result.stdout).toContain('Building face recognition engine');
    expect(result.stdout).toContain('Face recognition ready');
    expect(result.stdout).not.toContain('HAVE_C_WNON_VIRTUAL_DTOR');
    expect(result.stdout).not.toContain('Building a compiler dependency');
    expect(result.stderr).toBe('');
    const log = await Bun.file(context.log).text();
    expect(log).toContain('HAVE_C_WNON_VIRTUAL_DTOR');
    expect(log).toContain('Compiler diagnostic: checking optional features');
  } finally {
    await context.close();
  }
});

test('a failed optional native build preserves the engine and full diagnostics', async () => {
  const context = await fixture();
  try {
    await Bun.write(context.engine, 'previous working engine');
    const result = await context.run({ command: ['scripts/build-faces.ts', '--host'], fail: true });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('exit 7');
    expect(result.stderr).toContain(context.log);
    expect(result.stdout).not.toContain('Face recognition ready');
    expect(result.stdout).not.toContain('Compiler progress');
    expect(result.stderr).toContain('fatal error: fixture dependency is missing');
    expect(result.stderr).not.toContain('Compiler progress 0\n');
    const log = await Bun.file(context.log).text();
    expect(log).toContain('Compiler progress 0');
    expect(log).toContain('Compiler progress 149');
    expect(log).toContain('fatal error: fixture dependency is missing');
    expect(await Bun.file(context.engine).text()).toBe('previous working engine');
  } finally {
    await context.close();
  }
});

test(
  'a quiet compiler still reports elapsed progress when output is piped through Turbo or CI',
  async () => {
    const context = await fixture();
    try {
      const result = await context.run({
        command: ['scripts/build-faces.ts', '--host'],
        slow: true,
      });
      expect(result.code).toBe(0);
      expect(result.stdout).toMatch(/Building face recognition engine · [1-9]\d*s elapsed/);
      expect(result.stdout).toContain('Face recognition ready');
      expect(result.stdout).not.toContain('Building a compiler dependency');
      expect(result.stderr).toBe('');
    } finally {
      await context.close();
    }
  },
  SLOW_BUILD_TIMEOUT_MS,
);
