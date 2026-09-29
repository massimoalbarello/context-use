#!/usr/bin/env node
import { text } from 'node:stream/consumers';
import { connect, disconnect, finishAuthorization, status } from './connection';
import { PluginConfigSchema } from './contract';
import { ConnectionError } from './error';
import { refreshGateway } from './gateway';
import { verifyRuntime } from './host';
import { checkHost } from './host-command';
import { installedPlugin, installPackage } from './package-installation';
import { removalStatus, requestRemoval, waitForRemoval } from './removal';
import { OPENCLAW_INSTALL_COMMAND } from './setup-prompt';
import { connectionDirectory, readState } from './state';
import { SETUP_USAGE } from './usage';

async function connectCommand({
  directory,
  command,
  argument,
  agentArgument,
}: {
  directory: string;
  command: string;
  argument?: string;
  agentArgument?: string;
}): Promise<void> {
  const previous = await readState(directory);
  const instance = argument ?? (command === 'reconnect' ? previous?.config.serverUrl : undefined);
  const agentId = agentArgument ?? previous?.config.agentId ?? 'main';
  if (!instance) {
    throw new ConnectionError(SETUP_USAGE);
  }
  PluginConfigSchema.shape.agentId.parse(agentId);
  await installPackage();
  const result = await connect({
    directory,
    instance,
    agentId,
    reauthorize: command === 'reconnect',
  });
  if (result.authorizationUrl) {
    console.log(
      `Open this URL to authorize Context Use:\n${result.authorizationUrl}\n\nCopy the final localhost URL and send it back, even if the page does not load. Finish with ${OPENCLAW_INSTALL_COMMAND} authorize, passing the returned URL through standard input.`,
    );
  } else {
    console.log('Context Use authorized. Memory settings saved.');
    await refreshGateway();
  }
  return;
}

async function statusCommand(directory: string): Promise<void> {
  const removal = await removalStatus(directory);
  if (removal) {
    console.log(JSON.stringify({ connected: false, removal }, null, 2));
    return;
  }
  const result: Record<string, unknown> = {
    ...(await status(directory)),
    installed: Boolean(await installedPlugin()),
  };
  if (result.connected) {
    try {
      await verifyRuntime();
    } catch {
      result.connected = false;
      result.activationPending = true;
      result.error =
        'Memory settings are saved but native tools are not active. Finish active work, run refresh, then check status in a new turn.';
    }
  }
  console.log(JSON.stringify(result, null, 2));
  return;
}

async function main(args: string[]): Promise<void> {
  const [command, argument, agentArgument] = args;
  if (!command || command === '--help') {
    console.log(SETUP_USAGE);
    return;
  }
  await checkHost();
  const directory = connectionDirectory();
  const removal = await removalStatus(directory);
  if (removal && !['remove', 'status', 'refresh'].includes(command)) {
    throw new ConnectionError(
      removal.error ?? 'Removal is still running. Check status in a new turn before reconnecting.',
    );
  }
  switch (command) {
    case 'refresh':
      await refreshGateway();
      return;
    case 'connect':
    case 'reconnect': {
      await connectCommand({ directory, command, argument, agentArgument });
      return;
    }
    case 'authorize': {
      if (argument || process.stdin.isTTY) {
        throw new ConnectionError('Pass the returned authorization URL through standard input.');
      }
      const redirectUrl = (await text(process.stdin)).trim();
      await finishAuthorization({ directory, redirectUrl });
      console.log('Context Use authorized. Memory settings saved.');
      await refreshGateway();
      return;
    }
    case 'status': {
      await statusCommand(directory);
      return;
    }
    case 'disconnect': {
      const { preserved } = await disconnect(directory);
      console.log(
        `Disconnected. Remote memories are preserved.${preserved.length ? ` Kept user edits: ${preserved.join(', ')}.` : ''}`,
      );
      await refreshGateway();
      return;
    }
    case 'remove': {
      if (![undefined, '--wait'].includes(argument)) {
        throw new ConnectionError(SETUP_USAGE);
      }
      await requestRemoval(directory);
      if (argument !== '--wait') {
        console.log(
          'Local authorization cleared. Removal is running separately so this agent turn can finish. End this turn; check status in a new turn. Do not poll from this turn or restart the gateway. Remote memories and conversation history are preserved.',
        );
        return;
      }
      await waitForRemoval(directory);
      console.log('Context Use removed. Remote memories and conversation history are preserved.');
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
