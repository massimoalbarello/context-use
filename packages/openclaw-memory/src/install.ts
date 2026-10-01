import { setTimeout } from 'node:timers/promises';
import { mutateConfigFile } from 'openclaw/plugin-sdk/config-mutation';
import { PLUGIN_ID } from './contract';
import { openclaw } from './host-command';
import { installedPlugin } from './package-installation';

const DRAIN_TIMEOUT_MS = 120_000;
const DRAIN_RETRY_MS = 1_000;

function retainedWorkRejection(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const output = ['stdout', 'stderr']
    .map((key) => (key in error ? String(error[key as keyof typeof error]) : ''))
    .join('\n');
  return (
    output.includes('still has active retained work') && output.includes('replacement not applied')
  );
}

async function alreadyRemoved(error: unknown): Promise<boolean> {
  if (!error || typeof error !== 'object' || !('stderr' in error)) {
    return false;
  }
  // Host configuration warnings can precede the actual uninstall result.
  const messages = String(error.stderr).trim().split('\n');
  if (messages.includes(`Plugin not found: ${PLUGIN_ID}`)) {
    return true;
  }
  // Current hosts reject an untracked ID before producing a not-found result.
  // An unmanaged package can produce the same rejection, so verify discovery too.
  return (
    messages.some((message) =>
      message.startsWith(`Plugin "${PLUGIN_ID}" is not associated with a tracked package install.`),
    ) && !(await installedPlugin())
  );
}

async function clearPluginEntry(): Promise<void> {
  await mutateConfigFile({
    afterWrite: {
      mode: 'none',
      reason: 'Context Use setup requests gateway refresh after cleanup',
    },
    // A missing manifest makes this entry invalid before the CLI can uninstall
    // its tracked package. Repair only our entry, retaining core validation.
    writeOptions: { allowConfigSizeDrop: true, skipPluginValidation: true },
    mutate: (config) => {
      if (config.plugins?.entries) {
        delete config.plugins.entries[PLUGIN_ID];
      }
    },
  });
}

export async function uninstall(): Promise<void> {
  await clearPluginEntry();
  // Older hosts reject retained foreground work before committing. Retry only that
  // explicit non-commit result, from the detached remover, until the turn releases it.
  const deadline = Date.now() + DRAIN_TIMEOUT_MS;
  for (;;) {
    try {
      console.log(await openclaw(['plugins', 'uninstall', PLUGIN_ID, '--force']));
      break;
    } catch (error) {
      // Discovery excludes missing package files. Still ask the host to remove
      // orphaned install records, and accept only its explicit absent result.
      if (await alreadyRemoved(error)) {
        break;
      }
      if (Date.now() >= deadline || !retainedWorkRejection(error)) {
        throw error;
      }
      await setTimeout(DRAIN_RETRY_MS);
    }
  }
  // OpenClaw retains an enabled:false entry on uninstall. Remove our entry too.
  await clearPluginEntry();
}
