import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { ICruiseResult } from 'dependency-cruiser';

const WORKSPACE = resolve(import.meta.dir, '../../../../..');
const BACKEND = 'apps/context-use/backend';
const SOURCE = `${BACKEND}/src/`;
const CHECK_TIMEOUT_MS = 30_000;
const REPOSITORY = '#backend/repositories/entities/repository.ts';
const GRAPH = '#backend/repositories/hypermedia-graph/contract.ts';
const DECLARATIONS = 'export class Implementation {}\nexport interface Contract {}\n';

async function checkImports(files: Record<string, string>) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'context-use-boundaries-')));
  try {
    const app = await Bun.file(join(WORKSPACE, 'apps/context-use/package.json')).json();
    const fixtures = {
      'apps/context-use/package.json': JSON.stringify({ type: 'module', imports: app.imports }),
      ...Object.fromEntries(
        Object.entries(files).map(([path, text]) => [`${BACKEND}/${path}`, text]),
      ),
    };
    for (const [path, source] of Object.entries(fixtures)) {
      await mkdir(dirname(join(directory, path)), { recursive: true });
      await writeFile(join(directory, path), source);
    }
    const child = Bun.spawn({
      cmd: [
        'node',
        join(WORKSPACE, 'node_modules/dependency-cruiser/bin/dependency-cruiser.mjs'),
        '--config',
        join(WORKSPACE, BACKEND, 'dependency-cruiser.config.mjs'),
        '--output-type',
        'json',
        BACKEND,
      ],
      cwd: directory,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: CHECK_TIMEOUT_MS,
    });
    const [exitCode, output, errors] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(errors).toBe('');
    const result = JSON.parse(output) as ICruiseResult;
    expect(exitCode).toBe(0);
    // The JSON reporter always exits successfully; also verify the reporter used in CI.
    const enforcement = Bun.spawn({
      cmd: [
        'node',
        join(WORKSPACE, 'node_modules/dependency-cruiser/bin/dependency-cruiser.mjs'),
        '--config',
        join(WORKSPACE, BACKEND, 'dependency-cruiser.config.mjs'),
        BACKEND,
      ],
      cwd: directory,
      stdout: 'ignore',
      stderr: 'pipe',
      timeout: CHECK_TIMEOUT_MS,
    });
    const [enforcementExit, enforcementErrors] = await Promise.all([
      enforcement.exited,
      new Response(enforcement.stderr).text(),
    ]);
    expect(enforcementErrors).toBe('');
    expect(enforcementExit).toBe(result.summary.error);
    return result.summary.violations;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test(
  'runtime repository imports cannot bypass service contracts with alternate syntax',
  async () => {
    const attempts = {
      alias: `import { Implementation } from '${REPOSITORY}'; new Implementation();`,
      relative:
        "import { Implementation } from '../../repositories/entities/repository.ts'; new Implementation();",
      extensionless:
        "import { Implementation } from '../../repositories/entities/repository'; new Implementation();",
      reexport: `export { Implementation } from '${REPOSITORY}';`,
      star: `export * from '${REPOSITORY}';`,
      dynamic: `export const load = () => import('${REPOSITORY}');`,
      require: `export const repository = require('${REPOSITORY}');`,
      mixed: `import { type Contract, Implementation } from '${REPOSITORY}'; new Implementation();`,
      separate: `import type { Contract } from '${REPOSITORY}'; import { Implementation } from '${REPOSITORY}'; new Implementation();`,
    };
    const violations = await checkImports({
      'src/repositories/entities/repository.ts': DECLARATIONS,
      ...Object.fromEntries(
        Object.entries(attempts).map(([name, source]) => [
          `src/services/entities/${name}.ts`,
          source,
        ]),
      ),
    });
    expect(violations.map(({ from, rule }) => [from, rule.name]).sort()).toEqual(
      Object.keys(attempts)
        .map((name) => [
          `${SOURCE}services/entities/${name}.ts`,
          'services-use-repository-contracts',
        ])
        .sort(),
    );
  },
  CHECK_TIMEOUT_MS,
);

test(
  'contract imports, composition roots, same-capability helpers, and persistence tests remain allowed',
  async () => {
    expect(
      await checkImports({
        'src/repositories/entities/repository.ts': DECLARATIONS,
        'src/services/entities/alias.ts': `import type { Contract } from '${REPOSITORY}'; export type Input = Contract;`,
        'src/services/entities/inline.ts': `import { type Contract } from '${REPOSITORY}'; export type Input = Contract;`,
        'src/services/entities/relative.ts':
          "import type { Contract } from '../../repositories/entities/repository.ts'; export type Input = Contract;",
        'src/services/entities/service.ts': "export { Implementation } from './helper.ts';",
        'src/services/entities/helper.ts': DECLARATIONS,
        'src/db/client.ts': DECLARATIONS,
        'src/lib/env.ts': DECLARATIONS,
        'src/lib/storage/client.ts': DECLARATIONS,
        'src/main.ts': `import '${REPOSITORY}'; import '#backend/db/client.ts'; import '#backend/lib/env.ts'; import '#backend/lib/storage/client.ts';`,
        'src/routes/api/controller.ts':
          "import type { Input } from '#backend/services/entities/alias.ts';",
        'test/repositories/entities.test.ts': `import { Implementation } from '${REPOSITORY}'; new Implementation();`,
      }),
    ).toEqual([]);
  },
  CHECK_TIMEOUT_MS,
);

test(
  'layer ownership applies to relative paths and type-only dependencies',
  async () => {
    const cases = [
      [
        'models/entity/model.ts',
        '../../repositories/entities/repository.ts',
        'inner-layers-stay-independent',
      ],
      ['lib/helper.ts', '../services/entities/service.ts', 'inner-layers-stay-independent'],
      ['db/helper.ts', '../repositories/entities/repository.ts', 'database-stays-independent'],
      [
        'repositories/assets/repository.ts',
        '../../db/client.ts',
        'repositories-receive-infrastructure',
      ],
      [
        'repositories/pages/repository.ts',
        '../entities/repository.ts',
        'repository-capabilities-stay-independent',
      ],
      [
        'services/pages/service.ts',
        '../../routes/api/controller.ts',
        'services-stay-transport-independent',
      ],
      [
        'services/assets/service.ts',
        '../entities/service.ts',
        'service-capabilities-stay-independent',
      ],
      [
        'routes/api/controller.ts',
        '../../repositories/entities/repository.ts',
        'controllers-use-services',
      ],
      [
        'routes/api/model.ts',
        '../../services/entities/service.ts',
        'route-schemas-stay-independent',
      ],
      ['app.ts', './repositories/entities/repository.ts', 'controllers-use-services'],
      ['types.ts', './services/entities/service.ts', 'public-app-type-comes-from-app'],
      ['services/config/service.ts', '../../lib/env.ts', 'main-owns-production-infrastructure'],
    ] as const;
    const violations = await checkImports({
      'src/repositories/entities/repository.ts': DECLARATIONS,
      'src/services/entities/service.ts': DECLARATIONS,
      'src/db/client.ts': DECLARATIONS,
      'src/lib/env.ts': DECLARATIONS,
      ...Object.fromEntries(
        cases.map(([file, target]) => [
          `src/${file}`,
          `import type { Contract } from '${target}'; export type Input = Contract;`,
        ]),
      ),
    });
    for (const [file, , rule] of cases) {
      expect(violations).toContainEqual(
        expect.objectContaining({
          from: `${SOURCE}${file}`,
          rule: expect.objectContaining({ name: rule }),
        }),
      );
    }
    expect(violations.some(({ rule }) => rule.name === 'resolve-backend-imports')).toBe(false);
  },
  CHECK_TIMEOUT_MS,
);

test(
  'graph and retrieval repositories stay private to their owning services',
  async () => {
    const violations = await checkImports({
      'src/repositories/hypermedia-graph/contract.ts': DECLARATIONS,
      'src/repositories/hypermedia-graph/repository.ts':
        "import type { Contract } from './contract.ts';",
      'src/repositories/hypermedia-retrieval/contract.ts': DECLARATIONS,
      'src/services/hypermedia-graph/service.ts': `import type { Contract } from '${GRAPH}';`,
      'src/main.ts': "import '#backend/repositories/hypermedia-graph/repository.ts';",
      'src/views/reexport.ts': "export * from '../repositories/hypermedia-graph/repository.ts';",
      'src/views/dynamic.ts':
        "export const load = () => import('../repositories/hypermedia-graph/repository.ts');",
      'src/services/entities/service.ts': `import type { Contract } from '${GRAPH}';`,
      'src/services/hypermedia-retrieval/service.ts': `import type { Contract } from '${GRAPH}';`,
      'src/services/hypermedia-graph/search.ts':
        "import type { Contract } from '../../repositories/hypermedia-retrieval/contract.ts';",
    });
    expect(violations.map(({ from, rule }) => [from, rule.name]).sort()).toEqual(
      [
        [`${SOURCE}services/entities/service.ts`, 'graph-repository-is-private'],
        [`${SOURCE}services/hypermedia-graph/search.ts`, 'retrieval-service-owns-search'],
        [`${SOURCE}services/hypermedia-retrieval/service.ts`, 'graph-repository-is-private'],
        [`${SOURCE}views/dynamic.ts`, 'graph-repository-is-private'],
        [`${SOURCE}views/reexport.ts`, 'graph-repository-is-private'],
      ].sort(),
    );
  },
  CHECK_TIMEOUT_MS,
);

test(
  'missing internal targets fail rather than silently escaping boundary checks',
  async () => {
    const violations = await checkImports({
      'src/services/entities/service.ts':
        "import '#backend/repositories/missing/repository.ts'; import './missing.ts';",
    });
    expect(violations.filter(({ rule }) => rule.name === 'resolve-backend-imports')).toHaveLength(
      2,
    );
  },
  CHECK_TIMEOUT_MS,
);

test(
  'shared portrait cleanup remains allowed inside the entity transaction',
  async () => {
    const violations = await checkImports({
      'src/repositories/faces/portrait-links.ts': DECLARATIONS,
      'src/repositories/entities/repository.ts':
        "import { Implementation } from '../faces/portrait-links.ts';",
      'src/repositories/pages/repository.ts':
        "import { Implementation } from '../faces/portrait-links.ts';",
    });
    expect(violations.map(({ from, rule }) => [from, rule.name])).toEqual([
      [`${SOURCE}repositories/pages/repository.ts`, 'portrait-cleanup-stays-with-its-transaction'],
    ]);
  },
  CHECK_TIMEOUT_MS,
);
