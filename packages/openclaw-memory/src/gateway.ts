import { resolve } from 'node:path';
import { z } from 'zod';
import { PREPARE_REMOVAL_METHOD } from './contract';
import { ConnectionError } from './error';
import { openclaw } from './host-command';
import { OPENCLAW_INSTALL_COMMAND } from './setup-prompt';

const GatewayFailureSchema = z.object({
  error: z.object({
    type: z.string(),
    code: z.string().optional(),
    message: z.string(),
    reason: z.string().optional(),
  }),
});

function gatewayFailure(error: unknown) {
  try {
    const { stdout } = z.object({ stdout: z.string() }).parse(error);
    return GatewayFailureSchema.parse(JSON.parse(stdout)).error;
  } catch {
    return undefined;
  }
}

async function hasMatchingGateway(): Promise<boolean> {
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
  } catch (error) {
    const failure = gatewayFailure(error);
    if (
      failure?.type === 'gateway_transport_error' &&
      failure.reason?.startsWith('connect ECONNREFUSED ')
    ) {
      return false;
    }
    throw new ConnectionError(
      'Could not verify this profile’s gateway. Resolve its connection or authorization error and retry.',
    );
  }
  // config.get comes from the running gateway itself. Service-status output can
  // describe the account's default daemon even when this CLI uses isolated state.
  if (resolve(remote.path) !== resolve(local.path)) {
    throw new ConnectionError(
      'The running gateway uses another configuration. Start this profile’s gateway and retry.',
    );
  }
  return true;
}

export async function prepareGatewayRemoval(): Promise<void> {
  if (!(await hasMatchingGateway())) {
    return;
  }
  try {
    const result = JSON.parse(
      await openclaw(['gateway', 'call', PREPARE_REMOVAL_METHOD, '--timeout', '60000', '--json']),
    );
    z.object({ stopped: z.literal(true) }).parse(result);
  } catch (error) {
    // A disabled or absent plugin has no runtime method to prepare.
    const failure = gatewayFailure(error);
    if (
      failure?.type === 'gateway_request_error' &&
      failure.code === 'INVALID_REQUEST' &&
      failure.message === `unknown method: ${PREPARE_REMOVAL_METHOD}`
    ) {
      return;
    }
    throw new ConnectionError(
      'Could not stop Context Use learning. Run remove again to resume cleanup.',
    );
  }
}

export async function refreshGateway(): Promise<void> {
  if (!(await hasMatchingGateway())) {
    console.log(
      `Settings saved. No reachable gateway was verified; they apply on its next start. Run ${OPENCLAW_INSTALL_COMMAND} refresh to retry.`,
    );
    return;
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
