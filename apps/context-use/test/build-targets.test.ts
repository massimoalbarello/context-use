import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const BUILD_TEST_TIMEOUT_MS = 30_000;

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
