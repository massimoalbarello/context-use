import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
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

async function pluginInventory() {
  const inventory = z
    .object({
      plugins: z.array(
        z.object({
          id: z.string(),
          rootDir: z.string(),
          origin: z.string().optional(),
        }),
      ),
    })
    .parse(JSON.parse(await openclaw(['--log-level', 'silent', 'plugins', 'list', '--json'])));
  return inventory.plugins;
}

export async function installedPlugin() {
  return (await pluginInventory()).find((plugin) => plugin.id === PLUGIN_ID);
}

export async function hostSdkAnchor(): Promise<string> {
  const plugins = await pluginInventory();
  // External plugins may have a newer npm peer copy. Only the host's bundled roots
  // identify its SDK; loading another version can irreversibly migrate host state.
  for (const plugin of plugins.filter((entry) => entry.origin === 'bundled')) {
    try {
      return createRequire(join(plugin.rootDir, 'package.json')).resolve(
        'openclaw/plugin-sdk/config-mutation',
      );
    } catch {
      // Some bundled entries may have no resolvable SDK; inspect the next host entry.
    }
  }
  throw new ConnectionError(
    'Could not locate the OpenClaw SDK. Run openclaw plugins doctor and retry.',
  );
}

export async function installPackage(): Promise<void> {
  const existing = await installedPlugin();
  if (existing) {
    const installed = z
      .object({ name: z.string() })
      .parse(JSON.parse(await readFile(join(existing.rootDir, 'package.json'), 'utf8')));
    if (installed.name !== packageJson.name) {
      throw new ConnectionError(
        `The context-use plugin ID belongs to another package: ${installed.name}.`,
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
