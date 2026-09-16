/** biome-ignore-all lint/complexity/useMaxParams: Promise executors use positional arguments. */
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { assertHostVersion } from './contract';
import { ConnectionError } from './error';

const execute = promisify(execFile);
const HOST_TIMEOUT_MS = 120_000;

export async function runSetupCommand(input: { script: string; args: string[] }): Promise<number> {
  const child = spawn(process.execPath, [input.script, ...input.args], { stdio: 'inherit' });
  return await new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
}

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
