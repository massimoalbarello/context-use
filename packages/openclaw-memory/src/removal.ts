import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { ConnectionError } from './error';
import { writePrivateFile } from './private-files';
import { readState, withConnection, writeState } from './state';

const RemovalSchema = z.object({ pid: z.number().int().positive(), error: z.string().optional() });
const removalFile = (directory: string) => `${directory}.removal.json`;

export async function removalStatus(directory: string) {
  try {
    const operation = RemovalSchema.parse(
      JSON.parse(await readFile(removalFile(directory), 'utf8')),
    );
    let running = false;
    try {
      process.kill(operation.pid, 0);
      running = !operation.error;
    } catch {
      // An interrupted worker is retryable without reinstalling the plugin.
    }
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

export async function recordRemovalFailure(input: {
  directory: string;
  message: string;
}): Promise<void> {
  await writePrivateFile({
    path: removalFile(input.directory),
    data: JSON.stringify({
      pid: process.pid,
      error: input.message,
    }),
  });
}

export async function finishRemoval(directory: string): Promise<void> {
  await rm(removalFile(directory), { force: true });
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
      const scripts = dirname(fileURLToPath(import.meta.url));
      const child = spawn(
        process.execPath,
        ['--import', join(scripts, 'setup-runtime.js'), join(scripts, 'remove-worker.js')],
        {
          detached: true,
          stdio: 'ignore',
          env: process.env,
        },
      );
      await once(child, 'spawn');
      await writePrivateFile({
        path: removalFile(directory),
        data: JSON.stringify({ pid: child.pid }),
      });
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
