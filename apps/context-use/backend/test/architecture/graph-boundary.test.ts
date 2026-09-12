import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const WORKSPACE = resolve(import.meta.dir, '../../../../..');
const GRAPH_CONTRACT = '#backend/repositories/hypermedia-graph/contract.ts';
const GRAPH_REPOSITORY = '#backend/repositories/hypermedia-graph/repository.ts';
const GRAPH_SERVICE = '#backend/services/hypermedia-graph/service.ts';

async function lintImport({ file, source }: { file: string; source: string }) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'context-use-graph-boundary-')));
  try {
    const configuration = await Bun.file(join(WORKSPACE, 'biome.json')).json();
    configuration.vcs.enabled = false;
    const fixture = join(directory, 'apps/context-use/backend', file);
    await mkdir(dirname(fixture), { recursive: true });
    await writeFile(join(directory, 'biome.json'), JSON.stringify(configuration));
    await writeFile(fixture, source);
    return Bun.spawnSync({
      cmd: [
        process.execPath,
        Bun.resolveSync('@biomejs/biome/bin/biome', WORKSPACE),
        'lint',
        `--config-path=${directory}`,
        '--only=style/noRestrictedImports',
        join('apps/context-use/backend', file),
      ],
      cwd: directory,
      stdout: 'pipe',
      stderr: 'pipe',
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test.each([
  { file: 'src/app.ts', source: `import { X } from '${GRAPH_REPOSITORY}';` },
  {
    file: 'src/services/hypermedia-retrieval/service.ts',
    source: `import type { X } from '${GRAPH_CONTRACT}';`,
  },
  {
    file: 'src/services/entities/service.ts',
    source: `import type { X } from '${GRAPH_CONTRACT}';`,
  },
  {
    file: 'src/services/entities/service.ts',
    source: "import type { X } from '../../repositories/hypermedia-graph/contract.ts';",
  },
  {
    file: 'src/routes/api/hypermedia/controller.ts',
    source: `import { X } from '${GRAPH_REPOSITORY}';`,
  },
  {
    file: 'src/routes/api/hypermedia/model.ts',
    source: `import type { X } from '${GRAPH_CONTRACT}';`,
  },
  { file: 'src/models/entities/model.ts', source: `import type { X } from '${GRAPH_CONTRACT}';` },
  { file: 'src/lib/errors.ts', source: `import { X } from '${GRAPH_REPOSITORY}';` },
  {
    file: 'src/repositories/entities/repository.ts',
    source: "import type { X } from '../hypermedia-graph/contract.ts';",
  },
  {
    file: 'src/views/entities/entity-view.ts',
    source: "export * from '../../repositories/hypermedia-graph/repository.ts';",
  },
  {
    file: 'src/views/entities/entity-view.ts',
    source: `const graph = import('${GRAPH_REPOSITORY}');`,
  },
])('graph repository access is private: $file / $source', async (input) => {
  const result = await lintImport(input);
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr.toString()).toContain(
    'Graph queries must enter through HypermediaGraphService',
  );
});

test.each([
  { file: 'src/main.ts', source: `import { X } from '${GRAPH_REPOSITORY}';` },
  {
    file: 'src/services/hypermedia-graph/service.ts',
    source: `import type { X } from '${GRAPH_CONTRACT}';`,
  },
  {
    file: 'src/repositories/hypermedia-graph/repository.ts',
    source: "import type { X } from './contract.ts';",
  },
  {
    file: 'src/routes/api/hypermedia/controller.ts',
    source: `import type { X } from '${GRAPH_SERVICE}';`,
  },
  {
    file: 'test/repositories/hypermedia-graph/repository.test.ts',
    source: `import { X } from '${GRAPH_REPOSITORY}';`,
  },
])('graph service wiring and persistence tests remain allowed: $file', async (input) => {
  const result = await lintImport(input);
  expect(result.stderr.toString()).toBe('');
  expect(result.exitCode).toBe(0);
});

test('graph and retrieval remain independent application entrypoints', async () => {
  for (const input of [
    {
      file: 'src/services/hypermedia-graph/service.ts',
      source: "import type { X } from '#backend/services/hypermedia-retrieval/service.ts';",
    },
    {
      file: 'src/services/hypermedia-graph/service.ts',
      source: "import type { X } from '#backend/repositories/hypermedia-retrieval/contract.ts';",
    },
    {
      file: 'src/services/hypermedia-retrieval/service.ts',
      source: `import type { X } from '${GRAPH_SERVICE}';`,
    },
  ]) {
    const result = await lintImport(input);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain('noRestrictedImports');
  }
});
