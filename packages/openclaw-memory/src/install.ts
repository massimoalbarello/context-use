import { mutateConfigFile } from 'openclaw/plugin-sdk/config-mutation';
import { PLUGIN_ID } from './contract';
import { openclaw } from './host-command';
import { installedPlugin } from './package-installation';

export async function uninstall(): Promise<void> {
  if (await installedPlugin()) {
    console.log(await openclaw(['plugins', 'uninstall', PLUGIN_ID, '--force']));
  }
  // OpenClaw retains an enabled:false entry on uninstall. Remove our entry too.
  await mutateConfigFile({
    writeOptions: { allowConfigSizeDrop: true },
    mutate: (config) => {
      if (config.plugins?.entries) {
        delete config.plugins.entries[PLUGIN_ID];
      }
    },
  });
}
