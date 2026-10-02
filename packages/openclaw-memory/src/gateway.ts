import { resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
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
const PROBE_ATTEMPTS = 3;
const PROBE_RETRY_MS = 500;

function gatewayFailure(error: unknown) {
  try {
    const { stdout } = z.object({ stdout: z.string() }).parse(error);
    return GatewayFailureSchema.parse(JSON.parse(stdout)).error;
  } catch {
    return undefined;
  }
}

async function gatewayConfiguration(): Promise<{ path: string } | undefined> {
  for (let attempt = 1; ; attempt++) {
    try {
      return z
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
        return undefined;
      }
      // A deferred host refresh can briefly close the socket or reject the probe.
      // Retry only reads; never replay a cleanup or restart request with an uncertain result.
      const transient =
        failure?.type === 'gateway_transport_error' ||
        (failure?.type === 'gateway_request_error' && failure.code === 'UNAVAILABLE');
      if (!transient || attempt >= PROBE_ATTEMPTS) {
        throw new ConnectionError(
          'Could not verify this profile’s gateway. Resolve its connection or authorization error and retry.',
        );
      }
      await setTimeout(PROBE_RETRY_MS);
    }
  }
}

async function hasMatchingGateway(): Promise<boolean> {
  const local = z
    .object({ path: z.string() })
    .parse(JSON.parse(await openclaw(['config', 'file', '--json'])));
  const remote = await gatewayConfiguration();
  if (!remote) {
    return false;
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
  let matching: boolean;
  try {
    matching = await hasMatchingGateway();
  } catch {
    // Local removal must remain possible when gateway credentials are broken or
    // this CLI points at another profile. Never send cleanup to an unverified host.
    console.warn('Gateway cleanup could not be reached. Continuing local removal.');
    return;
  }
  if (!matching) {
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
