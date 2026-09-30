import { fork } from 'node:child_process';
import { once } from 'node:events';
import { readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { check, lock } from 'proper-lockfile';
import { z } from 'zod';
import { ConnectionError } from './error';
import { writePrivateFile } from './private-files';
import { readState, withConnection, writeState } from './state';

const RemovalSchema = z.object({ error: z.string().optional() });
const removalLease = { realpath: false, stale: 30_000, update: 2_000 };
export const removalFile = (directory: string) => `${directory}.removal.json`;

export async function removalStatus(directory: string) {
  try {
    const operation = RemovalSchema.parse(
      JSON.parse(await readFile(removalFile(directory), 'utf8')),
    );
    const running = await check(removalFile(directory), removalLease);
    return {
      running,
      error:
        operation.error ?? (running ? undefined : 'Removal was interrupted. Run remove again.'),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw new ConnectionError('Context Use removal status is unreadable.');
  }
}

// The worker owns a renewable filesystem lease, never a PID that another process can reuse.
export async function runRemoval(input: {
  directory: string;
  run: () => Promise<void>;
}): Promise<void> {
  const release = await lock(removalFile(input.directory), removalLease);
  let completed = false;
  try {
    process.send?.('ready');
    await input.run();
    completed = true;
  } catch (error) {
    await writePrivateFile({
      path: removalFile(input.directory),
      data: JSON.stringify({
        error:
          error instanceof ConnectionError
            ? error.message
            : 'Removal failed. Run remove again to resume cleanup.',
      }),
    });
    throw error;
  } finally {
    // Finish atomically with respect to a new connect/remove request.
    await withConnection({
      directory: input.directory,
      run: async () => {
        try {
          if (completed) {
            await rm(removalFile(input.directory), { force: true });
          }
        } finally {
          await release();
        }
      },
    });
  }
}

export async function requestRemoval(directory: string): Promise<void> {
  await withConnection({
    directory,
    run: async () => {
      if ((await removalStatus(directory))?.running) {
        return;
      }
      const state = await readState(directory);
      if (state) {
        state.oauth = {};
        await writeState({ directory, state });
      }
      await writePrivateFile({ path: removalFile(directory), data: '{}' });
      const scripts = dirname(fileURLToPath(import.meta.url));
      const child = fork(join(scripts, 'remove-worker.js'), [], {
        execArgv: ['--import', join(scripts, 'setup-runtime.js')],
        detached: true,
        stdio: 'ignore',
      });
      // Do not report success until the worker has acquired its lease. It then waits
      // for this connection lock before touching config or deleting private state.
      await Promise.race([
        once(child, 'message'),
        once(child, 'exit').then(() => {
          throw new ConnectionError('Removal could not start. Run remove again.');
        }),
      ]);
      child.disconnect();
      child.unref();
    },
  });
}

const REMOVAL_WAIT_MS = 180_000;
const REMOVAL_POLL_MS = 500;

export async function waitForRemoval(directory: string): Promise<void> {
  const deadline = Date.now() + REMOVAL_WAIT_MS;
  while (Date.now() < deadline) {
    const current = await removalStatus(directory);
    if (!current) {
      return;
    }
    if (current.error) {
      throw new ConnectionError(current.error);
    }
    await setTimeout(REMOVAL_POLL_MS);
  }
  throw new ConnectionError('Removal is still running. Check status in a new turn.');
}

export async function assertNotRemoving(directory: string): Promise<void> {
  if (await removalStatus(directory)) {
    throw new ConnectionError(
      'Finish removing Context Use before connecting or authorizing again.',
    );
  }
}
