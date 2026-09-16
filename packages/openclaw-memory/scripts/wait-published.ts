import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import { promisify } from 'node:util';

const run = promisify(execFile);
const AVAILABILITY_TIMEOUT_MS = 300_000;
const POLL_INTERVAL_MS = 5_000;

export async function waitForPublished({
  spec,
  integrity,
  timeoutMs = AVAILABILITY_TIMEOUT_MS,
  intervalMs = POLL_INTERVAL_MS,
  env = process.env,
}: {
  spec: string;
  integrity: string;
  timeoutMs?: number;
  intervalMs?: number;
  env?: NodeJS.ProcessEnv;
}): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  do {
    try {
      const { stdout } = await run(
        'npm',
        ['view', spec, 'dist.integrity', '--json', '--prefer-online', '--fetch-retries=0'],
        {
          env,
          timeout: Math.max(1, deadline - Date.now()),
        },
      );
      assert.equal(JSON.parse(stdout), integrity, `${spec} is available with different contents`);
      console.log(`${spec} is available from npm with the verified integrity.`);
      return;
    } catch (error) {
      if (Date.now() >= deadline && (error as { killed?: boolean }).killed) {
        break;
      }
      const output = (error as { stdout?: string }).stdout;
      // Retry only registry propagation misses. Auth, network and integrity errors fail immediately.
      if (!output || !['E404', 'ETARGET'].includes(JSON.parse(output).error?.code)) {
        throw error;
      }
    }
    await setTimeout(Math.min(intervalMs, Math.max(0, deadline - Date.now())));
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for ${spec} to become available from npm.`);
}

if (import.meta.main) {
  const [spec, integrity] = process.argv.slice(2);
  assert.ok(spec && integrity, 'Pass the exact package version and verified artifact integrity');
  await waitForPublished({ spec, integrity });
}
