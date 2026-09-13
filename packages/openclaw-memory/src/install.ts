import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { readConfigFileSnapshotForWrite } from 'openclaw/plugin-sdk/config-mutation';
import { z } from 'zod';
import packageJson from '../package.json';
import { PLUGIN_ID } from './contract';
import { ConnectionError } from './error';
import { openclaw } from './host';

const execute = promisify(execFile);
const INSTALL_TIMEOUT_MS = 120_000;

export async function install(): Promise<void> {
  const { snapshot } = await readConfigFileSnapshotForWrite();
  if (!snapshot.valid) {
    throw new ConnectionError('OpenClaw configuration is invalid. Run openclaw doctor first.');
  }
  if (snapshot.config.plugins?.entries?.[PLUGIN_ID]) {
    const info = z
      .object({ plugin: z.object({ packageName: z.string(), packageVersion: z.string() }) })
      .parse(JSON.parse(await openclaw(['plugins', 'info', PLUGIN_ID, '--json'])));
    if (
      info.plugin.packageName !== packageJson.name ||
      info.plugin.packageVersion !== packageJson.version
    ) {
      throw new ConnectionError(
        'A different Context Use plugin version is installed. Remove it before installing this package.',
      );
    }
    return;
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const directory = await mkdtemp(join(tmpdir(), 'context-use-install-'));
  try {
    // OpenClaw installs runtime dependencies for archives, but not copied local directories.
    const packed = await execute(
      'npm',
      ['pack', root, '--ignore-scripts', '--json', '--pack-destination', directory],
      { timeout: INSTALL_TIMEOUT_MS },
    );
    const [{ filename }] = z
      .tuple([z.object({ filename: z.string() })])
      .parse(JSON.parse(packed.stdout));
    console.log(
      await openclaw([
        'plugins',
        'install',
        join(directory, filename),
        '--force',
        '--accept-capabilities',
      ]),
    );
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'stderr' in error &&
      typeof error.stderr === 'string'
    ) {
      process.stderr.write(error.stderr);
    }
    throw new ConnectionError(
      'OpenClaw could not install Context Use. Resolve the installer error above and retry connect.',
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
