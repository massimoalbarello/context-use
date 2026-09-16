import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const WORKSPACE = resolve(import.meta.dir, '../../../../..');
const CHECK_TIMEOUT_MS = 30_000;

async function lintImports(files: Record<string, string>) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'context-use-sql-boundary-')));
  try {
    const configuration = await Bun.file(join(WORKSPACE, 'biome.json')).json();
    configuration.vcs.enabled = false;
    await writeFile(join(directory, 'biome.json'), JSON.stringify(configuration));
    for (const [file, source] of Object.entries(files)) {
      const fixture = join(directory, 'apps/context-use/backend/src', file);
      await mkdir(dirname(fixture), { recursive: true });
      await writeFile(fixture, source);
    }
    const child = Bun.spawn({
      cmd: [
        process.execPath,
        Bun.resolveSync('@biomejs/biome/bin/biome', WORKSPACE),
        'lint',
        `--config-path=${directory}`,
        '--only=style/noRestrictedImports',
        'apps/context-use/backend/src',
      ],
      cwd: directory,
      stdout: 'ignore',
      stderr: 'pipe',
      timeout: CHECK_TIMEOUT_MS,
    });
    const [exitCode, errors] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    return { exitCode, errors };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test(
  'application and domain layers cannot import SQL clients directly',
  async () => {
    const files = {
      'models/entities/model.ts': "import type { SQL } from 'bun';",
      'services/entities/service.ts': "import { SQL as Database } from 'bun';",
      'routes/api/controller.ts': "import { Database } from 'bun:sqlite';",
      'routes/api/model.ts': "import type { SQL } from 'bun';",
      'app.ts': "import { SQL } from 'bun';",
      'types.ts': "export type { SQL } from 'bun';",
    };
    const result = await lintImports(files);
    expect(result.exitCode).toBe(1);
    for (const file of Object.keys(files)) {
      expect(result.errors).toContain(`${file}:1:`);
    }
    expect(result.errors).toContain('noRestrictedImports');
  },
  CHECK_TIMEOUT_MS,
);

test(
  'persistence keeps SQL access and other Bun utilities remain available',
  async () => {
    const result = await lintImports({
      'repositories/entities/repository.ts': "import type { SQL } from 'bun';",
      'db/client.ts': "import { SQL } from 'bun';",
      'db/sqlite.ts': "import { Database } from 'bun:sqlite';",
      'main.ts': "import { SQL } from 'bun';",
      'services/entities/service.ts': "import { file } from 'bun';",
    });
    expect(result).toEqual({ exitCode: 0, errors: '' });
  },
  CHECK_TIMEOUT_MS,
);
