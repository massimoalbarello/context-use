import { resolve } from 'node:path';
import { z } from 'zod';
import { ConnectionError } from './error';
import { openclaw } from './host-command';
import { OPENCLAW_INSTALL_COMMAND } from './setup-prompt';
import { restoreWorkspace } from './workspace';

// Recovery must work from npm even after the plugin and its host SDK link are removed.
export async function runRecoveryCommand(args: string[]): Promise<boolean> {
  switch (args[0]) {
    case 'refresh':
      await refreshGateway();
      return true;
    case 'restore-workspace': {
      if (!args[1]) {
        throw new ConnectionError('Provide the workspace recovery backup directory.');
      }
      const preserved = await restoreWorkspace(args[1]);
      console.log(
        `Workspace backup restored.${preserved.length ? ` Kept later edits: ${preserved.join(', ')}.` : ''}`,
      );
      return true;
    }
    default:
      return false;
  }
}

export async function refreshGateway(): Promise<void> {
  const local = z
    .object({ path: z.string() })
    .parse(JSON.parse(await openclaw(['config', 'file', '--json'])));
  let remote: { path: string };
  try {
    remote = z
      .object({ path: z.string() })
      .parse(
        JSON.parse(
          await openclaw(['gateway', 'call', 'config.get', '--timeout', '3000', '--json']),
        ),
      );
  } catch {
    console.log(
      `Settings saved. No reachable gateway was verified; they apply on its next start. Run ${OPENCLAW_INSTALL_COMMAND} refresh to retry.`,
    );
    return;
  }
  // config.get comes from the running gateway itself. Service-status output can
  // describe the account's default daemon even when this CLI uses isolated state.
  if (resolve(remote.path) !== resolve(local.path)) {
    throw new ConnectionError(
      `Settings saved, but the running gateway uses another configuration. Start this profile’s gateway, then run ${OPENCLAW_INSTALL_COMMAND} refresh.`,
    );
  }
  const result = z
    .object({ ok: z.boolean() })
    .parse(
      JSON.parse(
        await openclaw([
          'gateway',
          'call',
          'gateway.restart.request',
          '--params',
          JSON.stringify({ reason: 'Context Use memory configuration changed' }),
          '--json',
        ]),
      ),
    );
  if (!result.ok) {
    throw new ConnectionError(
      `Settings saved, but gateway refresh was not accepted. Run ${OPENCLAW_INSTALL_COMMAND} refresh to retry.`,
    );
  }
  console.log(
    'Gateway refresh requested. OpenClaw will apply the change after active work finishes.',
  );
}
