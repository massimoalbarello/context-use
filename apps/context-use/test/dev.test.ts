import { expect, test } from 'bun:test';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('development starts the server without requiring a native build or production frontend', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'context-use-dev-test-'));
  try {
    await cp(new URL('../scripts/dev.ts', import.meta.url), join(directory, 'dev.ts'));
    await Bun.write(
      join(directory, 'backend/src/main.ts'),
      'console.log(JSON.stringify({ public: PUBLIC_FRONTEND_DIR_NAME, migrations: DB_MIGRATIONS_DIR_NAME }));',
    );
    const child = Bun.spawn([process.execPath, 'run', 'dev.ts'], {
      cwd: directory,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(code, stderr).toBe(0);
    expect(JSON.parse(stdout)).toEqual({
      public: '.frontend-served-by-vite',
      migrations: 'migrations',
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
