import { expect, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { deploymentTarget } from './deploy-nibrun';

const EXECUTABLE_MODE = 0o755;
const BUILD_FAILURE_CODE = 7;
const DEPLOY_TEST_TIMEOUT_MS = 30_000;

test('deployment requires an explicit creation or redeployment target', () => {
  expect(deploymentTarget(['--new', 'context-use-landing'])).toEqual([
    '--name',
    'context-use-landing',
  ]);
  expect(deploymentTarget(['--app', 'steve-jobs-demo-abc123'])).toEqual([
    '--app',
    'steve-jobs-demo-abc123',
  ]);
  for (const args of [
    [],
    ['--app', ''],
    ['--new', ' '],
    ['--app', 'one', '--new', 'two'],
    ['--app', ' ', '--new', 'valid'],
  ]) {
    expect(() => deploymentTarget(args)).toThrow('Choose --new');
  }
  expect(() => deploymentTarget(['--name', 'old-option'])).toThrow('Unknown option');
});

async function deploymentFixture(task = 'build:instance') {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'context-use-deploy-test-')));
  const app = join(root, 'apps', 'test app');
  const bin = join(root, 'bin');
  const invocation = join(root, 'nib-args.json');
  await mkdir(app, { recursive: true });
  await mkdir(bin);
  await Bun.write(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'deploy-test',
      private: true,
      packageManager: 'bun@1.4.0',
      workspaces: ['apps/*'],
    }),
  );
  await Bun.write(
    join(root, 'bun.lock'),
    JSON.stringify({
      lockfileVersion: 1,
      configVersion: 1,
      workspaces: { '': { name: 'deploy-test' }, 'apps/test app': { name: '@fixture/app' } },
      packages: {},
    }),
  );
  await Bun.write(
    join(root, 'turbo.json'),
    JSON.stringify({
      tasks: { [task]: { outputs: ['dist/**'], env: ['BUILD_TARGET', 'TEST_BUILD_FAIL'] } },
    }),
  );
  await Bun.write(
    join(app, 'package.json'),
    JSON.stringify({
      name: '@fixture/app',
      private: true,
      scripts: { [task]: 'bun run build.ts' },
    }),
  );
  await Bun.write(
    join(app, 'build.ts'),
    `
    if (process.env.TEST_BUILD_FAIL) process.exit(${BUILD_FAILURE_CODE});
    await Bun.write('dist/app', process.env.BUILD_TARGET ?? 'missing target');
  `,
  );
  await Bun.write(
    join(app, 'deploy.ts'),
    `
    import { deployToNibrun } from ${JSON.stringify(new URL('./deploy-nibrun.ts', import.meta.url).href)};
    await deployToNibrun({ directory: import.meta.dir, binary: 'dist/app', task: ${JSON.stringify(task)} });
  `,
  );
  const nib = join(bin, 'nib');
  await Bun.write(
    nib,
    `#!${process.execPath}
    await Bun.write(${JSON.stringify(invocation)}, JSON.stringify(process.argv.slice(2)));
  `,
  );
  await chmod(nib, EXECUTABLE_MODE);
  return {
    app,
    invocation,
    async run({ args, fail = false }: { args: string[]; fail?: boolean }) {
      const child = Bun.spawn([process.execPath, 'run', 'deploy.ts', ...args], {
        cwd: app,
        env: {
          ...process.env,
          PATH: `${bin}:${resolve(import.meta.dir, '../../../node_modules/.bin')}:${process.env.PATH}`,
          BUILD_TARGET: 'host',
          TEST_BUILD_FAIL: fail ? '1' : undefined,
        },
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      return { code, output: stdout + stderr };
    },
    async [Symbol.asyncDispose]() {
      await rm(root, { recursive: true, force: true });
    },
  };
}

test.each(['build:instance', 'build:demo', 'build'])(
  'deployment selects %s and builds Linux x64 before sending one binary to nib',
  async (task) => {
    await using fixture = await deploymentFixture(task);
    const result = await fixture.run({ args: ['--app', 'existing-slug'] });
    expect(result.code, result.output).toBe(0);
    expect(await Bun.file(join(fixture.app, 'dist/app')).text()).toBe('bun-linux-x64');
    expect(await Bun.file(fixture.invocation).json()).toEqual([
      'run',
      join(fixture.app, 'dist/app'),
      '--app',
      'existing-slug',
      '--port',
      '3000',
    ]);
  },
  DEPLOY_TEST_TIMEOUT_MS,
);

test(
  'new deployments translate the creation option to nibrun',
  async () => {
    await using fixture = await deploymentFixture();
    const result = await fixture.run({ args: ['--new', 'context-use-landing'] });
    expect(result.code, result.output).toBe(0);
    expect(await Bun.file(fixture.invocation).json()).toEqual([
      'run',
      join(fixture.app, 'dist/app'),
      '--name',
      'context-use-landing',
      '--port',
      '3000',
    ]);
  },
  DEPLOY_TEST_TIMEOUT_MS,
);

test(
  'a failed build never invokes nibrun',
  async () => {
    await using fixture = await deploymentFixture();
    const result = await fixture.run({ args: ['--new', 'context-use'], fail: true });
    expect(result.code).not.toBe(0);
    expect(await Bun.file(fixture.invocation).exists()).toBe(false);
  },
  DEPLOY_TEST_TIMEOUT_MS,
);
