import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { readConfigFileSnapshotForWrite } from 'openclaw/plugin-sdk/config-mutation';
import { z } from 'zod';
import { assertHostVersion, MCP_TOOL_NAMES, PLUGIN_ID, toolName } from './contract';
import { ConnectionError } from './error';

const execute = promisify(execFile);
const HOST_TIMEOUT_MS = 120_000;

export async function openclaw(args: string[]): Promise<string> {
  const result = await execute('openclaw', args, {
    timeout: HOST_TIMEOUT_MS,
    maxBuffer: 4_000_000,
  });
  return result.stdout;
}

export async function checkHost(): Promise<void> {
  const output = await openclaw(['--version']);
  const version = output.match(/\b\d{4}\.\d+\.\d+(?:-[\w.-]+)?\b/)?.[0];
  if (!version) {
    throw new ConnectionError('Could not determine the installed OpenClaw version.');
  }
  assertHostVersion(version);
}

export async function refreshGateway(): Promise<void> {
  const { snapshot } = await readConfigFileSnapshotForWrite();
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
      'Settings saved. No reachable gateway was verified; they apply on its next start. Run this helper with refresh to retry.',
    );
    return;
  }
  // config.get comes from the running gateway itself. Service-status output can
  // describe the account's default daemon even when this CLI uses isolated state.
  if (resolve(remote.path) !== resolve(snapshot.path)) {
    throw new ConnectionError(
      'Settings saved, but the running gateway uses another configuration. Start this profile’s gateway, then run refresh.',
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
      'Settings saved, but gateway refresh was not accepted. Run refresh to retry.',
    );
  }
  console.log(
    'Gateway refresh requested. OpenClaw will apply the change after active work finishes.',
  );
}

export async function refreshLocalMemory(agentId: string): Promise<void> {
  const { snapshot } = await readConfigFileSnapshotForWrite();
  const memory = snapshot.config.plugins?.slots?.memory ?? 'memory-core';
  if (
    memory === 'memory-core' &&
    snapshot.config.plugins?.entries?.['memory-core']?.enabled !== false
  ) {
    await openclaw(['memory', 'index', '--agent', agentId, '--force']);
  }
}

export async function verifyRuntime(): Promise<void> {
  const { plugin } = z
    .object({ plugin: z.object({ status: z.string(), toolNames: z.array(z.string()) }) })
    .parse(JSON.parse(await openclaw(['plugins', 'inspect', PLUGIN_ID, '--runtime', '--json'])));
  if (
    plugin.status !== 'loaded' ||
    !MCP_TOOL_NAMES.every((name) => plugin.toolNames.includes(toolName(name)))
  ) {
    throw new ConnectionError(
      'Context Use native tools did not load. Run openclaw plugins doctor, or disconnect to restore the previous settings.',
    );
  }
}
