import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { z } from 'zod';
import packageJson from '../package.json';
import { PLUGIN_ID } from './contract';
import { ConnectionError } from './error';
import { openclaw } from './host-command';

const execute = promisify(execFile);
const INSTALL_TIMEOUT_MS = 120_000;

export async function installedPlugin() {
  const inventory = z
    .object({
      plugins: z.array(
        z.object({
          id: z.string(),
          rootDir: z.string(),
        }),
      ),
    })
    .parse(JSON.parse(await openclaw(['plugins', 'list', '--json'])));
  return inventory.plugins.find((plugin) => plugin.id === PLUGIN_ID);
}

export async function installPackage(): Promise<void> {
  const existing = await installedPlugin();
  if (existing) {
    const installed = z
      .object({ name: z.string(), version: z.string() })
      .parse(JSON.parse(await readFile(join(existing.rootDir, 'package.json'), 'utf8')));
    if (installed.name !== packageJson.name || installed.version !== packageJson.version) {
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
