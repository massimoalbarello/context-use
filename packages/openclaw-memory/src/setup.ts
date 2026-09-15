#!/usr/bin/env node
import { text } from 'node:stream/consumers';
import { connect, disconnect, finishAuthorization, status } from './connection';
import { PluginConfigSchema } from './contract';
import { ConnectionError } from './error';
import { refreshLocalMemory, verifyRuntime } from './host';
import { checkHost } from './host-command';
import { uninstall } from './install';
import { refreshGateway, runRecoveryCommand } from './recovery';
import { OPENCLAW_INSTALL_COMMAND } from './setup-prompt';
import { connectionDirectory } from './state';
import { SETUP_USAGE } from './usage';

async function main(args: string[]): Promise<void> {
  const [command, argument, agentId = 'main'] = args;
  if (!command || command === '--help') {
    console.log(SETUP_USAGE);
    return;
  }
  await checkHost();
  if (await runRecoveryCommand(args)) {
    return;
  }
  const directory = connectionDirectory();
  switch (command) {
    case 'connect': {
      if (!argument) {
        throw new ConnectionError(SETUP_USAGE);
      }
      PluginConfigSchema.shape.agentId.parse(agentId);
      const result = await connect({ directory, instance: argument, agentId });
      if (result.authorizationUrl) {
        console.log(
          `Open this URL to authorize Context Use:\n${result.authorizationUrl}\n\nCopy the final localhost URL and send it back, even if the page does not load. Finish with ${OPENCLAW_INSTALL_COMMAND} authorize, passing the returned URL through standard input.`,
        );
      } else {
        await verifyRuntime();
        console.log('Context Use connected.');
        await refreshGateway();
      }
      return;
    }
    case 'authorize': {
      if (argument || process.stdin.isTTY) {
        throw new ConnectionError('Pass the returned authorization URL through standard input.');
      }
      const redirectUrl = (await text(process.stdin)).trim();
      await finishAuthorization({ directory, redirectUrl });
      await verifyRuntime();
      console.log('Context Use connected.');
      await refreshGateway();
      return;
    }
    case 'status': {
      const result = await status(directory);
      if (result.connected) {
        await verifyRuntime();
      }
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    case 'disconnect':
    case 'remove': {
      const { preserved, agentId } = await disconnect(directory);
      console.log(
        `Disconnected. Remote memories are preserved.${preserved.length ? ` Kept user edits: ${preserved.join(', ')}.` : ''}`,
      );
      if (command === 'remove') {
        await uninstall();
      }
      await refreshLocalMemory(agentId);
      await refreshGateway();
      return;
    }
    default:
      throw new ConnectionError(SETUP_USAGE);
  }
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  // OAuth/HTTP libraries may include response bodies and URLs in their errors.
  // Never print an upstream authorization response or child-process output here.
  console.error(
    error instanceof ConnectionError
      ? error.message
      : 'Context Use setup failed. Check the OpenClaw version, connection and setup instructions, then retry.',
  );
  process.exitCode = 1;
}
