import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const TEST_TIMEOUT_MS = 30_000;

test(
  'local removal tolerates an unreachable gateway and prepares only the matching profile',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'context-use-gateway-'));
    try {
      const command = join(directory, 'openclaw');
      await writeFile(
        command,
        `#!/bin/sh
case "$*" in
  'config file --json') echo '{"path":"/fixture/openclaw.json"}' ;;
  *config.get*)
    case "$REMOVAL_CASE" in
      mismatch) echo '{"path":"/another/openclaw.json"}' ;;
      offline) echo '{"ok":false,"error":{"type":"gateway_transport_error","message":"Gateway not reachable","reason":"connect ECONNREFUSED 127.0.0.1:18789"}}'; exit 1 ;;
      unauthorized) echo '{"ok":false,"error":{"type":"gateway_auth_error","message":"token mismatch"}}'; exit 1 ;;
      unavailable) echo '{"ok":false,"error":{"type":"gateway_request_error","code":"UNAVAILABLE","message":"gateway rejected websocket upgrade (HTTP 503)"}}'; exit 1 ;;
      timeout) echo '{"ok":false,"error":{"type":"gateway_transport_error","message":"Gateway timed out","reason":"timeout"}}'; exit 1 ;;
      invalid-probe) echo 'not JSON' ;;
      recovering) if [ ! -f "$PROBE_FILE" ]; then touch "$PROBE_FILE"; echo '{"error":{"type":"gateway_transport_error","message":"Gateway closed","reason":"read ECONNRESET"}}'; exit 1; fi; echo '{"path":"/fixture/openclaw.json"}' ;;
      *) echo '{"path":"/fixture/openclaw.json"}' ;;
    esac ;;
  *context-use.prepare-removal*)
    touch "$PREPARED_FILE"
    case "$REMOVAL_CASE" in
      absent-json) echo '{"ok":false,"error":{"type":"gateway_request_error","code":"INVALID_REQUEST","message":"unknown method: context-use.prepare-removal"}}'; exit 1 ;;
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
      for (const scenario of [
        'ready',
        'offline',
        'absent-json',
        'mismatch',
        'failed',
        'uncertain',
        'unauthorized',
        'unavailable',
        'timeout',
        'invalid-probe',
        'recovering',
      ]) {
        const child = Bun.spawn(
          [
            process.execPath,
            '-e',
            `import {prepareGatewayRemoval} from ${JSON.stringify(resolve(import.meta.dir, '../src/gateway.ts'))}; await prepareGatewayRemoval();`,
          ],
          {
            env: {
              ...process.env,
              PATH: `${directory}:${process.env.PATH}`,
              REMOVAL_CASE: scenario,
              PROBE_FILE: join(directory, 'probe'),
              PREPARED_FILE: join(directory, `${scenario}.prepared`),
            },
            stdout: 'pipe',
            stderr: 'pipe',
          },
        );
        const code = await child.exited;
        const error = await new Response(child.stderr).text();
        expect(existsSync(join(directory, `${scenario}.prepared`))).toBe(
          ['ready', 'absent-json', 'failed', 'uncertain', 'recovering'].includes(scenario),
        );
        if (!['failed', 'uncertain'].includes(scenario)) {
          expect(code).toBe(0);
        } else {
          expect(code).not.toBe(0);
          expect(error).toContain('Could not stop');
        }
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
  TEST_TIMEOUT_MS,
);
