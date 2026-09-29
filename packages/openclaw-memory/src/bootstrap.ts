#!/usr/bin/env node
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { satisfies } from 'semver';
import metadata from '../package.json';
import { serverUrl } from './contract';
import { ConnectionError } from './error';
import { refreshGateway } from './gateway';
import { checkHost, runSetupCommand } from './host-command';
import { hostSdkAnchor } from './package-installation';
import { SETUP_USAGE } from './usage';

// Resolve the host SDK explicitly so the current npm helper can repair old or removed installs.
async function main(args: string[]): Promise<void> {
  if (!args[0] || args[0] === '--help') {
    console.log(SETUP_USAGE);
    return;
  }
  if (!satisfies(process.versions.node, metadata.engines.node)) {
    throw new ConnectionError(
      `This setup command requires Node ${metadata.engines.node}; found ${process.versions.node}. Use the Node runtime supported by your OpenClaw installation.`,
    );
  }
  if (args[0] === 'connect') {
    if (!args[1]) {
      throw new ConnectionError('Provide the Context Use instance URL.');
    }
    serverUrl(args[1]);
  }
  await checkHost();
  if (args[0] === 'refresh') {
    await refreshGateway();
    return;
  }
  const directory = dirname(fileURLToPath(import.meta.url));
  process.env.CONTEXT_USE_OPENCLAW_SDK = await hostSdkAnchor();
  process.exitCode = await runSetupCommand({
    script: join(directory, 'setup.js'),
    runtime: join(directory, 'setup-runtime.js'),
    args,
  });
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  console.error(
    error instanceof ConnectionError
      ? error.message
      : 'Context Use installation failed. Check the OpenClaw installation and retry.',
  );
  process.exitCode = 1;
}
