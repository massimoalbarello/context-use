import { expect, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repository = resolve(import.meta.dir, '../../..');
const EXECUTABLE_MODE = 0o755;
const DEPLOY_TEST_TIMEOUT_MS = 30_000;
const TERMINAL_COLUMNS = 220;

test(
  'the root deploy command keeps Docker recovery visible without unrelated output in a terminal',
  async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'context-use-deploy-output-')));
    try {
      const app = join(root, 'apps/context-use');
      const bin = join(root, 'bin');
      await mkdir(bin);
      const files = [
        'turbo.json',
        'apps/context-use/scripts/deploy-instance.ts',
        'apps/context-use/backend/scripts/build-faces.ts',
        'apps/context-use/backend/scripts/shared/build-assets.ts',
        'apps/context-use/backend/scripts/shared/build-target.ts',
      ];
      for (const path of files) {
        const destination = join(root, path);
        await mkdir(resolve(destination, '..'), { recursive: true });
        await Bun.write(destination, Bun.file(join(repository, path)));
      }
      const rootPackage = await Bun.file(join(repository, 'package.json')).json();
      const appPackage = await Bun.file(join(repository, 'apps/context-use/package.json')).json();
      await Bun.write(
        join(root, 'package.json'),
        JSON.stringify({
          name: 'deploy-output-test',
          packageManager: rootPackage.packageManager,
          workspaces: ['apps/*'],
          scripts: { 'deploy:instance': rootPackage.scripts['deploy:instance'] },
        }),
      );
      await Bun.write(
        join(app, 'package.json'),
        JSON.stringify({
          name: appPackage.name,
          scripts: {
            'deploy:instance': appPackage.scripts['deploy:instance'],
            'build:faces': appPackage.scripts['build:faces'],
            'build:client': 'echo "unrelated frontend build chatter"',
            'build:instance': 'exit 99',
          },
        }),
      );
      await Bun.write(
        join(root, 'bun.lock'),
        JSON.stringify({
          lockfileVersion: 1,
          configVersion: 1,
          workspaces: {
            '': { name: 'deploy-output-test' },
            'apps/context-use': { name: appPackage.name },
          },
          packages: {},
        }),
      );
      // Finish a successful task before the failure so its output cannot be hidden by cancellation.
      const turbo = await Bun.file(join(root, 'turbo.json')).json();
      turbo.tasks['build:faces'].dependsOn = ['build:client'];
      await Bun.write(join(root, 'turbo.json'), JSON.stringify(turbo));
      await mkdir(join(app, 'node_modules/@repo'), { recursive: true });
      await symlink(
        join(repository, 'packages/build-tools'),
        join(app, 'node_modules/@repo/build-tools'),
      );
      const invocation = join(root, 'unexpected-deployment');
      await Bun.write(
        join(bin, 'nib'),
        `#!${process.execPath}
if (process.argv[2] === '--json') {
  console.log(JSON.stringify({ apps: [{ slug: 'context-use-abcd12' }] }));
} else {
  await Bun.write(${JSON.stringify(invocation)}, 'started');
  process.exit(99);
}
`,
      );
      await Bun.write(
        join(bin, 'docker'),
        `#!${process.execPath}
console.error('Docker client plugin inventory');
console.error('Cannot connect to the Docker daemon at fixture.sock');
process.exit(1);
`,
      );
      await chmod(join(bin, 'nib'), EXECUTABLE_MODE);
      await chmod(join(bin, 'docker'), EXECUTABLE_MODE);
      const chunks: Buffer[] = [];
      await using terminal = new Bun.Terminal({
        cols: TERMINAL_COLUMNS,
        // biome-ignore lint/complexity/useMaxParams: Bun's terminal callback supplies the terminal and data.
        data: (_terminal, chunk) => chunks.push(Buffer.from(chunk)),
      });
      const child = Bun.spawn(
        [process.execPath, 'run', 'deploy:instance', '--app', 'context-use'],
        {
          cwd: root,
          env: {
            ...process.env,
            CI: undefined,
            PATH: `${bin}:${join(repository, 'node_modules/.bin')}:${process.env.PATH}`,
            FACE_ENGINE_CACHE_HIT: undefined,
          },
          terminal,
          timeout: DEPLOY_TEST_TIMEOUT_MS,
        },
      );
      const code = await child.exited;
      const output = Bun.stripANSI(Buffer.concat(chunks).toString());
      expect(code, output).toBe(1);
      expect(output).toContain('Docker is not running or cannot be reached.');
      expect(output).toContain('open Docker Desktop');
      expect(output).toContain('wait until `docker info` succeeds');
      expect(output).toContain('Full build output:');
      expect(output).not.toContain('lines elided');
      expect(output).not.toContain('unrelated frontend build chatter');
      expect(output).not.toContain('Docker client plugin inventory');
      expect(output).not.toContain('fixture.sock');
      expect(output).not.toContain('ShellError');
      expect(await Bun.file(invocation).exists()).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  DEPLOY_TEST_TIMEOUT_MS,
);
