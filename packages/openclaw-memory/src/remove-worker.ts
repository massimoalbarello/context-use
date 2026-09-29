import { rm } from 'node:fs/promises';
import { disconnect } from './connection';
import { ConnectionError } from './error';
import { refreshGateway } from './gateway';
import { uninstall } from './install';
import { runRemoval } from './removal';
import { connectionDirectory } from './state';

// A separate process lets the requesting agent release its memory-provider generation.
// OpenClaw still owns runtime draining and package deletion; never force-stop its gateway.
const directory = connectionDirectory();
try {
  await runRemoval({
    directory,
    run: async () => {
      let step = 'restore memory settings';
      try {
        await disconnect(directory);
        step = 'uninstall the package after active OpenClaw work finishes';
        await uninstall();
        // The host has now drained the old plugin generation. Remove any files a
        // callback already in flight recreated after credentials were cleared.
        step = 'clear remaining private data';
        await rm(directory, { recursive: true, force: true });
        step = 'refresh the gateway';
        await refreshGateway();
      } catch (error) {
        throw new ConnectionError(
          error instanceof ConnectionError
            ? error.message
            : `Could not ${step}. Run remove again to resume cleanup.`,
        );
      }
    },
  });
} catch {
  process.exitCode = 1;
}
