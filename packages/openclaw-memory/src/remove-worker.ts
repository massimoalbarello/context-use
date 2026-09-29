import { disconnect } from './connection';
import { ConnectionError } from './error';
import { refreshGateway } from './gateway';
import { uninstall } from './install';
import { finishRemoval, recordRemovalFailure } from './removal';
import { connectionDirectory } from './state';

// A separate process lets the requesting agent release its memory-provider generation.
// OpenClaw still owns runtime draining and package deletion; never force-stop its gateway.
const directory = connectionDirectory();
let step = 'restore memory settings';
try {
  await disconnect(directory);
  step = 'uninstall the package after active OpenClaw work finishes';
  await uninstall();
  step = 'refresh the gateway';
  await refreshGateway();
  await finishRemoval(directory);
} catch (error) {
  await recordRemovalFailure({
    directory,
    message:
      error instanceof ConnectionError
        ? error.message
        : `Could not ${step}. Run remove again to resume cleanup.`,
  });
  process.exitCode = 1;
}
