import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const BUILD_TEST_TIMEOUT_MS = 30_000;

test(
  'landing build cache changes when shared logo source changes',
  async () => {
    const repository = resolve(root, '../..');
    const fixture = await mkdtemp(resolve(tmpdir(), 'context-use-build-cache-'));
    try {
      const files = [
        'package.json',
        'bun.lock',
        'turbo.json',
        'apps/landing/package.json',
        'packages/ui/package.json',
        'packages/build-tools/package.json',
        'packages/typescript-config/package.json',
        'packages/ui/src/components/brand/light/quality.ts',
      ];
      for (const path of files) {
        const destination = resolve(fixture, path);
        await mkdir(resolve(destination, '..'), { recursive: true });
        await Bun.write(destination, Bun.file(resolve(repository, path)));
      }
      const buildHash = async () => {
        const child = Bun.spawn(
          [
            resolve(repository, 'node_modules/.bin/turbo'),
            'build',
            '--filter=@repo/landing',
            '--dry=json',
          ],
          { cwd: fixture, stdout: 'pipe', stderr: 'pipe' },
        );
        const [code, output, errors] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ]);
        expect(code, errors).toBe(0);
        const plan: { tasks: { taskId: string; hash: string }[] } = JSON.parse(output);
        const task = plan.tasks.find((entry) => entry.taskId === '@repo/landing#build');
        expect(task).toBeDefined();
        return task!.hash;
      };
      const before = await buildHash();
      expect(await buildHash()).toBe(before);
      const source = Bun.file(
        resolve(fixture, 'packages/ui/src/components/brand/light/quality.ts'),
      );
      await Bun.write(source, `${await source.text()}\n// Changed shared logo source.\n`);
      expect(await buildHash()).not.toBe(before);
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  },
  BUILD_TEST_TIMEOUT_MS,
);

test(
  'runtime bundles preserve instance, demo, and landing isolation',
  async () => {
    const entries = ['backend/src/main.ts', 'demo/main.ts', '../landing/src/server.ts'];
    const child = Bun.spawn(
      [
        process.execPath,
        '-e',
        `
    const graphs = {};
    for (const entry of ${JSON.stringify(entries)}) {
      const result = await Bun.build({ entrypoints: [entry], target: 'bun', metafile: true });
      if (!result.success) throw new AggregateError(result.logs);
      graphs[entry] = Object.keys(result.metafile.inputs);
    }
    console.log(JSON.stringify(graphs));
  `,
      ],
      { cwd: root, stdout: 'pipe', stderr: 'inherit' },
    );
    const graphs: Record<string, string[]> = JSON.parse(await new Response(child.stdout).text());
    expect(await child.exited).toBe(0);
    const instance = graphs['backend/src/main.ts']!;
    expect(instance.some((path) => path.endsWith('/lib/auth/better-auth.ts'))).toBe(true);
    expect(instance.filter((path) => /(^|\/)(demo|landing|fixtures)\//.test(path))).toEqual([]);
    expect(
      graphs['demo/main.ts']!.filter(
        (path) =>
          /\/(local-analyzer|model-files|seed)\.ts$/.test(path) || path.includes('/fixtures/'),
      ),
    ).toEqual([]);
    expect(
      graphs['../landing/src/server.ts']!.filter((path) =>
        /context-use\/(backend|frontend)\//.test(path),
      ),
    ).toEqual([]);
  },
  BUILD_TEST_TIMEOUT_MS,
);

const BUILD_PLANS = [
  {
    command: 'build:instance',
    tasks: [
      '@repo/context-use#build:client',
      '@repo/context-use#build:faces',
      '@repo/context-use#build:instance',
    ],
  },
  {
    command: 'build:demo',
    tasks: [
      '@repo/context-use#build:demo',
      '@repo/context-use#build:demo:client',
      '@repo/context-use#build:faces:host',
    ],
  },
  { command: 'build:landing', tasks: ['@repo/landing#build'] },
];

test.each(BUILD_PLANS)(
  '$command schedules only its own binary and prerequisites',
  async ({ command, tasks }) => {
    const child = Bun.spawn([process.execPath, 'run', command, '--dry=json'], {
      cwd: resolve(root, '../..'),
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [code, output, errors] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(code, errors).toBe(0);
    const plan: { tasks: { taskId: string; command: string }[] } = JSON.parse(output);
    expect(
      plan.tasks
        .filter((task) => task.command !== '<NONEXISTENT>')
        .map((task) => task.taskId)
        .sort(),
    ).toEqual(tasks);
  },
  BUILD_TEST_TIMEOUT_MS,
);
