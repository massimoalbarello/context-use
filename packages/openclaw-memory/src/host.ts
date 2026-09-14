import { readConfigFileSnapshotForWrite } from 'openclaw/plugin-sdk/config-mutation';
import { z } from 'zod';
import { MCP_TOOL_NAMES, PLUGIN_ID, toolName } from './contract';
import { ConnectionError } from './error';
import { openclaw } from './host-command';

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
