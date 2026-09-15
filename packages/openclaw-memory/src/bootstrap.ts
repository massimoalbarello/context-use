#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { satisfies } from 'semver';
import metadata from '../package.json';
import { serverUrl } from './contract';
import { ConnectionError } from './error';
import { refreshGateway } from './gateway';
import { checkHost } from './host-command';
import { installedPlugin, installPackage } from './package-installation';
import { SETUP_USAGE } from './usage';

// npm exec does not have access to the host SDK. Install through OpenClaw first,
// then delegate to the installed package, whose SDK dependencies the host owns.
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
  if (args[0] === 'connect') {
    await installPackage();
  }
  const installed = await installedPlugin();
  if (!installed) {
    throw new ConnectionError('Context Use is not installed. Run connect first.');
  }
  const child = spawn(process.execPath, [join(installed.rootDir, 'dist/setup.js'), ...args], {
    stdio: 'inherit',
  });
  // biome-ignore lint/complexity/useMaxParams: Promise executors receive resolve and reject.
  process.exitCode = await new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
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
