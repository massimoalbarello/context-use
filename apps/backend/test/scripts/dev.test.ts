import { expect, test } from 'bun:test';
import { chmod, cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const backend = resolve(import.meta.dir, '../..');
const EXECUTABLE_MODE = 0o755;

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'context-use-dev-build-test-'));
  const app = join(root, 'apps/backend');
  const bin = join(root, 'bin');
  await mkdir(join(app, 'scripts/shared'), { recursive: true });
  await mkdir(join(app, 'src'));
  await mkdir(bin);
  for (const path of ['dev.ts', 'build-faces.ts', 'shared/constants.ts']) {
    await cp(join(backend, 'scripts', path), join(app, 'scripts', path));
  }
  await Bun.write(join(app, 'src/main.ts'), `console.log('Backend started');`);
  // Only the slow external compiler is substituted; the actual dev and build scripts run in Bun.
  await Bun.write(
    join(bin, 'cmake'),
    `#!${process.execPath}
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
if (process.argv.includes('--build')) {
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
    run: async ({ command, fail = false }: { command: string[]; fail?: boolean }) => {
      const child = Bun.spawn([process.execPath, 'run', ...command], {
        cwd: app,
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          TEST_COMPILER_FAILURE: fail ? '1' : undefined,
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

test('dev starts without a native engine or working compiler', async () => {
  const context = await fixture();
  try {
    expect(await Bun.file(context.engine).exists()).toBe(false);
    const result = await context.run({ command: ['scripts/dev.ts'], fail: true });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Backend started');
    expect(await Bun.file(context.engine).exists()).toBe(false);
    expect(await Bun.file(context.log).exists()).toBe(false);
  } finally {
    await context.close();
  }
});

test('the optional native build installs the local engine', async () => {
  const context = await fixture();
  try {
    const result = await context.run({ command: ['scripts/build-faces.ts', '--host'] });
    expect(result.code).toBe(0);
    expect(await Bun.file(context.engine).text()).toBe('compiled engine');
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
    const log = await Bun.file(context.log).text();
    expect(log).toContain('Compiler progress 0');
    expect(log).toContain('Compiler progress 149');
    expect(log).toContain('fatal error: fixture dependency is missing');
    expect(await Bun.file(context.engine).text()).toBe('previous working engine');
  } finally {
    await context.close();
  }
});
