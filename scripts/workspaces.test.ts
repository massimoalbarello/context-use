import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const WORKSPACE_TEST_TIMEOUT_MS = 30_000;
const workspaces = ['apps', 'packages'].flatMap((folder) =>
  readdirSync(join(root, folder), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const directory = join(root, folder, entry.name);
      const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
      return {
        directory,
        application: folder === 'apps',
        name: manifest.name as string,
        dependencies: {
          ...manifest.dependencies,
          ...manifest.devDependencies,
          ...manifest.peerDependencies,
        } as Record<string, string>,
      };
    }),
);

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (['node_modules', 'dist', '.cache', '.turbo', 'public'].includes(entry.name)) {
      return [];
    }
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sources(path) : /\.tsx?$/.test(path) ? [path] : [];
  });
}

test('deployable apps are leaves of an acyclic workspace dependency graph', () => {
  expect(
    workspaces
      .filter((workspace) => workspace.application)
      .map((workspace) => workspace.name)
      .sort(),
  ).toEqual(['@repo/context-use', '@repo/demo', '@repo/landing']);
  const byName = new Map(workspaces.map((workspace) => [workspace.name, workspace]));
  function visit({ name, ancestors }: { name: string; ancestors: Set<string> }) {
    expect(
      ancestors.has(name),
      `Circular workspace dependency: ${[...ancestors, name].join(' → ')}`,
    ).toBe(false);
    const workspace = byName.get(name)!;
    for (const [dependency, version] of Object.entries(workspace.dependencies)) {
      if (!dependency.startsWith('@repo/')) {
        continue;
      }
      const target = byName.get(dependency);
      expect(target, `${name} depends on a missing workspace: ${dependency}`).toBeDefined();
      expect(target!.application, `${name} must not depend on an application: ${dependency}`).toBe(
        false,
      );
      expect(version, `${name} must use the workspace protocol for ${dependency}`).toStartWith(
        'workspace:',
      );
      visit({ name: dependency, ancestors: new Set([...ancestors, name]) });
    }
  }
  for (const workspace of workspaces) {
    visit({ name: workspace.name, ancestors: new Set() });
  }
});

function assertImport({
  specifier,
  path,
  workspace,
}: {
  specifier: string;
  path: string;
  workspace: (typeof workspaces)[number];
}) {
  if (
    specifier.startsWith('#') ||
    specifier.startsWith('node:') ||
    specifier.startsWith('bun:') ||
    specifier === 'bun' ||
    builtinModules.includes(specifier)
  ) {
    return;
  }
  if (specifier.startsWith('.')) {
    const resolved = resolve(dirname(path), specifier);
    const owner = workspaces.find((candidate) => resolved.startsWith(`${candidate.directory}/`));
    expect(
      owner?.name ?? workspace.name,
      `${path} crosses a workspace boundary with ${specifier}`,
    ).toBe(workspace.name);
    return;
  }
  const dependency = specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : specifier.split('/')[0]!;
  expect(
    workspace.dependencies[dependency],
    `${path} imports undeclared dependency ${dependency}`,
  ).toBeDefined();
  if (dependency.startsWith('@repo/')) {
    expect(
      () => Bun.resolveSync(specifier, dirname(path)),
      `${path} imports a private or missing export ${specifier}`,
    ).not.toThrow();
  }
}

test(
  'source imports use declared dependencies and package exports',
  () => {
    const ts = new Bun.Transpiler({ loader: 'ts' });
    const tsx = new Bun.Transpiler({ loader: 'tsx' });
    for (const workspace of workspaces) {
      for (const path of sources(workspace.directory)) {
        const transpiler = path.endsWith('.tsx') ? tsx : ts;
        for (const { path: specifier } of transpiler.scanImports(readFileSync(path, 'utf8'))) {
          assertImport({ specifier, path, workspace });
        }
      }
    }
  },
  WORKSPACE_TEST_TIMEOUT_MS,
);

test(
  'runtime bundles preserve instance, demo, and landing isolation',
  async () => {
    const entries = ['apps/context-use/main.ts', 'apps/demo/main.ts', 'apps/landing/server.ts'];
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
    const instance = graphs['apps/context-use/main.ts']!;
    expect(instance.some((path) => path.endsWith('/lib/auth/better-auth.ts'))).toBe(true);
    expect(instance.filter((path) => /\/(demo|landing|seeds)\//.test(path))).toEqual([]);
    expect(
      graphs['apps/demo/main.ts']!.filter(
        (path) => /\/(local-analyzer|model-files|seed)\.ts$/.test(path) || path.includes('/seeds/'),
      ),
    ).toEqual([]);
    expect(
      graphs['apps/landing/server.ts']!.filter((path) =>
        /packages\/(backend|frontend)\//.test(path),
      ),
    ).toEqual([]);
  },
  WORKSPACE_TEST_TIMEOUT_MS,
);
