import { expect, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { deploymentTarget } from './deploy-nibrun';

const EXECUTABLE_MODE = 0o755;
const BUILD_FAILURE_CODE = 7;
const LIST_FAILURE_CODE = 9;
const DEPLOY_TEST_TIMEOUT_MS = 30_000;
const NAME_LENGTH_BEFORE_TRUNCATED_HYPHEN = 55;
const NAME_BEFORE_TRUNCATED_HYPHEN = 'a'.repeat(NAME_LENGTH_BEFORE_TRUNCATED_HYPHEN);

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
  const listing = join(root, 'nib-apps.json');
  await mkdir(app, { recursive: true });
  await mkdir(bin);
  await Bun.write(listing, JSON.stringify({ apps: [{ slug: 'existing-slug' }] }));
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
    const args = process.argv.slice(2);
    if (JSON.stringify(args) === JSON.stringify(['--json', 'apps', 'list'])) {
      if (process.env.TEST_LIST_FAIL) {
        console.error('Not signed in. Run nib login.');
        process.exit(${LIST_FAILURE_CODE});
      }
      process.stdout.write(await Bun.file(${JSON.stringify(listing)}).text());
    } else if (args[0] === 'run') {
      await Bun.write(${JSON.stringify(invocation)}, JSON.stringify(args));
    } else {
      throw new Error('Unexpected nib invocation: ' + JSON.stringify(args));
    }
  `,
  );
  await chmod(nib, EXECUTABLE_MODE);
  return {
    app,
    invocation,
    listing,
    async run({
      args,
      fail = false,
      listFail = false,
    }: {
      args: string[];
      fail?: boolean;
      listFail?: boolean;
    }) {
      const child = Bun.spawn([process.execPath, 'run', 'deploy.ts', ...args], {
        cwd: app,
        env: {
          ...process.env,
          PATH: `${bin}:${resolve(import.meta.dir, '../../../node_modules/.bin')}:${process.env.PATH}`,
          BUILD_TARGET: 'host',
          TEST_BUILD_FAIL: fail ? '1' : undefined,
          TEST_LIST_FAIL: listFail ? '1' : undefined,
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
    await Bun.write(
      fixture.listing,
      JSON.stringify({
        apps: [
          { slug: 'context-use-demo-v0gmx7' },
          { slug: 'context-use-abcd12' },
          { slug: 'context-use-landing-qw4pz1' },
        ],
      }),
    );
    const result = await fixture.run({ args: ['--app', 'context-use'] });
    expect(result.code, result.output).toBe(0);
    expect(await Bun.file(join(fixture.app, 'dist/app')).text()).toBe('bun-linux-x64');
    expect(await Bun.file(fixture.invocation).json()).toEqual([
      'run',
      join(fixture.app, 'dist/app'),
      '--app',
      'context-use-abcd12',
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
    // Creation does not depend on listing existing apps.
    await Bun.write(fixture.listing, 'invalid listing');
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
  'an exact slug takes precedence over apps whose name starts with that slug',
  async () => {
    await using fixture = await deploymentFixture();
    await Bun.write(
      fixture.listing,
      JSON.stringify({
        apps: [
          { slug: 'context-use-abcd12-efgh34' },
          { slug: 'context-use-abcd12-jkmn56' },
          { slug: 'context-use-abcd12' },
        ],
      }),
    );
    const result = await fixture.run({ args: ['--app', 'context-use-abcd12'] });
    expect(result.code, result.output).toBe(0);
    expect(await Bun.file(fixture.invocation).json()).toContain('context-use-abcd12');
  },
  DEPLOY_TEST_TIMEOUT_MS,
);

test.each([
  { name: 'Café Demo!', slug: 'cafe-demo-abcd12' },
  {
    name: `${NAME_BEFORE_TRUNCATED_HYPHEN}--long-name`,
    slug: `${NAME_BEFORE_TRUNCATED_HYPHEN}-abcd12`,
  },
])(
  'redeployment resolves names normalized by nibrun: $name',
  async ({ name, slug }) => {
    await using fixture = await deploymentFixture();
    await Bun.write(fixture.listing, JSON.stringify({ apps: [{ slug }] }));
    const result = await fixture.run({ args: ['--app', name] });
    expect(result.code, result.output).toBe(0);
    expect(await Bun.file(fixture.invocation).json()).toContain(slug);
  },
  DEPLOY_TEST_TIMEOUT_MS,
);

test(
  'ambiguous names list exact slugs and stop before building or deploying',
  async () => {
    await using fixture = await deploymentFixture();
    await Bun.write(
      fixture.listing,
      JSON.stringify({
        apps: [{ slug: 'context-use-abcd12' }, { slug: 'context-use-efgh34' }],
      }),
    );
    const result = await fixture.run({ args: ['--app', 'context-use'] });
    expect(result.code).not.toBe(0);
    expect(result.output).toContain('Multiple nibrun apps match "context-use"');
    expect(result.output).toContain('--app context-use-abcd12');
    expect(result.output).toContain('--app context-use-efgh34');
    expect(await Bun.file(join(fixture.app, 'dist/app')).exists()).toBe(false);
    expect(await Bun.file(fixture.invocation).exists()).toBe(false);
  },
  DEPLOY_TEST_TIMEOUT_MS,
);

test.each([{ apps: [] }, { apps: [{ slug: 'context-use-demo-v0gmx7' }] }])(
  'a missing name stops before building or deploying, without matching another app prefix',
  async ({ apps }) => {
    await using fixture = await deploymentFixture();
    await Bun.write(fixture.listing, JSON.stringify({ apps }));
    const result = await fixture.run({ args: ['--app', 'context-use'] });
    expect(result.code).not.toBe(0);
    expect(result.output).toContain('No nibrun app matches "context-use"');
    expect(await Bun.file(join(fixture.app, 'dist/app')).exists()).toBe(false);
    expect(await Bun.file(fixture.invocation).exists()).toBe(false);
  },
  DEPLOY_TEST_TIMEOUT_MS,
);

test.each([
  'not JSON',
  JSON.stringify({ apps: [{ slug: 'context-use-abcd12' }, { slug: null }] }),
  JSON.stringify({ apps: null }),
])(
  'an invalid app listing stops before building or deploying',
  async (listing) => {
    await using fixture = await deploymentFixture();
    await Bun.write(fixture.listing, listing);
    const result = await fixture.run({ args: ['--app', 'context-use'] });
    expect(result.code).not.toBe(0);
    expect(await Bun.file(join(fixture.app, 'dist/app')).exists()).toBe(false);
    expect(await Bun.file(fixture.invocation).exists()).toBe(false);
  },
  DEPLOY_TEST_TIMEOUT_MS,
);

test(
  'a failed app lookup reports the CLI error and stops before building or deploying',
  async () => {
    await using fixture = await deploymentFixture();
    const result = await fixture.run({ args: ['--app', 'context-use'], listFail: true });
    expect(result.code).not.toBe(0);
    expect(result.output).toContain('Not signed in. Run nib login.');
    expect(await Bun.file(join(fixture.app, 'dist/app')).exists()).toBe(false);
    expect(await Bun.file(fixture.invocation).exists()).toBe(false);
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
