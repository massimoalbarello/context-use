import { expect, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { deploymentTarget } from './deploy-nibrun';

const EXECUTABLE_MODE = 0o755;
const BUILD_FAILURE_CODE = 7;
const DEPLOY_TEST_TIMEOUT_MS = 30_000;

test('deployment requires an explicit creation or redeployment target', () => {
  expect(deploymentTarget(['--name', 'context-use-landing'])).toEqual([
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
    ['--name', ' '],
    ['--app', 'one', '--name', 'two'],
    ['--app', ' ', '--name', 'valid'],
  ]) {
    expect(() => deploymentTarget(args)).toThrow('Choose --name');
  }
});

async function deploymentFixture() {
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
      tasks: { build: { outputs: ['dist/**'], env: ['BUILD_TARGET', 'TEST_BUILD_FAIL'] } },
    }),
  );
  await Bun.write(
    join(app, 'package.json'),
    JSON.stringify({
      name: '@fixture/app',
      private: true,
      scripts: { build: 'bun run build.ts' },
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
    await deployToNibrun({ directory: import.meta.dir, binary: 'dist/app' });
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
    async run(fail: boolean) {
      const child = Bun.spawn([process.execPath, 'run', 'deploy.ts', '--app', 'existing-slug'], {
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

test(
  'deployment builds Linux x64 before passing one binary and the exact target to nib',
  async () => {
    await using fixture = await deploymentFixture();
    const result = await fixture.run(false);
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
  'a failed build never invokes nibrun',
  async () => {
    await using fixture = await deploymentFixture();
    const result = await fixture.run(true);
    expect(result.code).not.toBe(0);
    expect(await Bun.file(fixture.invocation).exists()).toBe(false);
  },
  DEPLOY_TEST_TIMEOUT_MS,
);
