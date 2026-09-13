import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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
