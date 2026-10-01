import { expect, test } from 'bun:test';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const TEST_TIMEOUT_MS = 60_000;

test(
  'uninstall retains the host marker, recognizes absence and never replays a failed mutation',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'context-use-uninstall-'));
    try {
      const command = join(root, 'openclaw');
      await writeFile(
        command,
        `#!/bin/sh
case "$*" in
  *'plugins list --json')
    if [ "$REMOVAL_CASE" = untracked-absent ]; then echo '{"plugins":[]}'; else echo '{"plugins":[{"id":"context-use","rootDir":"/fixture"}]}'; fi ;;
  'plugins uninstall context-use --force')
    echo attempt >> "$ATTEMPTS_FILE"
    echo '[config] warnings: plugins.entries.active-memory: plugin disabled but config is present' >&2
    case "$REMOVAL_CASE" in
      removed) echo 'Uninstalled plugin "context-use".'; exit 0 ;;
      busy) echo 'Plugin memory-core still has active retained work; retry after the work finishes. Gateway generation 4: replacement not applied.' >&2 ;;
      uncertain) echo 'Plugin memory-core still has active retained work; connection lost' >&2 ;;
      failed) echo 'File cleanup failed after publication' >&2 ;;
      absent) echo 'Plugin not found: context-use' >&2 ;;
      other-absent) echo 'Plugin not found: another-plugin' >&2 ;;
      untracked-absent|untracked-present) echo 'Plugin "context-use" is not associated with a tracked package install. Refresh the plugin registry, then reinstall the package or run openclaw doctor before retrying.' >&2 ;;
    esac
    exit 1 ;;
  *) exit 2 ;;
esac
`,
      );
      const executableMode = 0o700;
      await chmod(command, executableMode);
      for (const scenario of [
        'removed',
        'busy',
        'uncertain',
        'failed',
        'absent',
        'other-absent',
        'untracked-absent',
        'untracked-present',
      ]) {
        const attempts = join(root, `${scenario}.attempts`);
        const stateDir = join(root, scenario);
        const child = Bun.spawn(
          [
            process.execPath,
            '-e',
            `import {uninstall} from ${JSON.stringify(resolve(import.meta.dir, '../src/install.ts'))}; await uninstall();`,
          ],
          {
            env: {
              ...process.env,
              PATH: `${root}:${process.env.PATH}`,
              REMOVAL_CASE: scenario,
              ATTEMPTS_FILE: attempts,
              OPENCLAW_STATE_DIR: stateDir,
              OPENCLAW_CONFIG_PATH: join(stateDir, 'openclaw.json'),
            },
            stdout: 'pipe',
            stderr: 'pipe',
          },
        );
        const code = await child.exited;
        expect((await readFile(attempts, 'utf8')).trim().split('\n')).toHaveLength(1);
        const completed = ['removed', 'absent', 'untracked-absent'].includes(scenario);
        expect(code === 0).toBe(completed);
        const config = JSON.parse(await readFile(join(stateDir, 'openclaw.json'), 'utf8'));
        expect(config.plugins.entries['context-use']).toEqual(
          completed ? { enabled: false } : undefined,
        );
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  TEST_TIMEOUT_MS,
);
