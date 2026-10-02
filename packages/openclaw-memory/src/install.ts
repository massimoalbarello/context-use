import { mutateConfigFile } from 'openclaw/plugin-sdk/config-mutation';
import { PLUGIN_ID } from './contract';
import { openclaw } from './host-command';
import { installedPlugin } from './package-installation';

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

async function writeRemovalEntry(entry: { enabled: false } | undefined): Promise<void> {
  await mutateConfigFile({
    afterWrite: {
      mode: 'none',
      reason: 'Context Use setup requests gateway refresh after cleanup',
    },
    // Repair only our entry when an orphan install points to a missing manifest.
    // The SDK still validates the core configuration.
    writeOptions: { allowConfigSizeDrop: true, skipPluginValidation: true },
    mutate: (config) => {
      config.plugins ??= {};
      config.plugins.entries ??= {};
      if (entry) {
        config.plugins.entries[PLUGIN_ID] = entry;
      } else {
        delete config.plugins.entries[PLUGIN_ID];
      }
    },
  });
}

export async function uninstall(): Promise<void> {
  // Even a disabled entry can fail validation while its tracked manifest is missing.
  await writeRemovalEntry(undefined);
  try {
    // OpenClaw owns runtime draining, package files, install records and policy.
    console.log(await openclaw(['plugins', 'uninstall', PLUGIN_ID, '--force']));
  } catch (error) {
    // Discovery excludes missing package files. Still ask the host to remove
    // orphaned install records, and accept only its explicit absent result.
    if (!(await alreadyRemoved(error))) {
      throw error;
    }
  }
  // Keep the host's explicit uninstall choice, including when already absent.
  // Startup repair must not automatically reinstall a package the user removed.
  await writeRemovalEntry({ enabled: false });
}
