import { expect, test } from 'bun:test';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('removal preparation requires the matching profile and a confirmed cleanup receipt', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'context-use-gateway-'));
  try {
    const command = join(directory, 'openclaw');
    await writeFile(
      command,
      `#!/bin/sh
case "$*" in
  'config file --json') echo '{"path":"/fixture/openclaw.json"}' ;;
  *config.get*)
    if [ "$REMOVAL_CASE" = mismatch ]; then echo '{"path":"/another/openclaw.json"}';
    else echo '{"path":"/fixture/openclaw.json"}'; fi ;;
  *context-use.prepare-removal*)
    case "$REMOVAL_CASE" in
      absent) echo 'unknown method: context-use.prepare-removal' >&2; exit 1 ;;
      absent-json) echo '{"ok":false,"error":{"code":"INVALID_REQUEST","message":"unknown method: context-use.prepare-removal"}}'; exit 1 ;;
      failed) echo 'cleanup failed' >&2; exit 1 ;;
      uncertain) echo '{"stopped":false}' ;;
      *) echo '{"stopped":true}' ;;
    esac ;;
  *) exit 2 ;;
esac
`,
    );
    const executableMode = 0o700;
    await chmod(command, executableMode);
    for (const scenario of ['ready', 'absent', 'absent-json', 'mismatch', 'failed', 'uncertain']) {
      const child = Bun.spawn(
        [
          process.execPath,
          '-e',
          `import {prepareGatewayRemoval} from ${JSON.stringify(resolve(import.meta.dir, '../src/gateway.ts'))}; await prepareGatewayRemoval();`,
        ],
        {
          env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, REMOVAL_CASE: scenario },
          stdout: 'pipe',
          stderr: 'pipe',
        },
      );
      const code = await child.exited;
      const error = await new Response(child.stderr).text();
      if (['ready', 'absent', 'absent-json'].includes(scenario)) {
        expect(code).toBe(0);
      } else {
        expect(code).not.toBe(0);
        expect(error).toContain(
          scenario === 'mismatch' ? 'another configuration' : 'Could not stop',
        );
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
