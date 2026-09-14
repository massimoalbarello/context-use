#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { connect, disconnect, finishAuthorization, status } from './connection';
import { PluginConfigSchema } from './contract';
import { ConnectionError } from './error';
import { refreshGateway, refreshLocalMemory, verifyRuntime } from './host';
import { checkHost } from './host-command';
import { install, uninstall } from './install';
import { OPENCLAW_INSTALL_COMMAND } from './setup-prompt';
import { connectionDirectory, withConnection } from './state';
import { restoreWorkspace } from './workspace';

const usage = `context-use-openclaw connect <instance-url> [agent-id=main]
context-use-openclaw authorize <redirect-url-file|->
context-use-openclaw status
context-use-openclaw disconnect
context-use-openclaw remove
context-use-openclaw refresh
context-use-openclaw restore-workspace <backup-directory>

Authorize reads the pasted redirect URL from a private file or stdin, keeping the code out of process arguments.
Use the same OpenClaw profile environment for every command.

Install the released package with:
${OPENCLAW_INSTALL_COMMAND} connect <instance-url> [agent-id=main].
For local development: bun install, then bun run --cwd packages/openclaw-memory build:plugin.
Run the checkout helper with Node from packages/openclaw-memory/pkg/dist/setup.js.

Connect checks the installation and configures the memory slot, tools and Active Memory.
The owner opens the authorization link on any device, uses their passkey, and sends back
its final localhost callback address. A failed localhost page is expected; no listener is needed.
An authorized OpenClaw agent can perform setup itself; only passkey authorization needs the owner.
After authorize, delete the temporary callback file. Setup requests a gateway refresh automatically.
After authorization, these commands are also available as openclaw context-use <command>.

This version supports one personal agent and one Context Use account across separate personal conversations.
Setup preserves your existing conversation/session scope.
Memory works across the agent's direct chats, groups, channels and forum topics.
Access to connected chats is managed through OpenClaw's channel configuration.
Disconnect restores setup-owned settings while preserving later edits and remote memories.
Use remove for credential cleanup and uninstall; native disable alone retains connection state.
Connect and removal retire recognized obsolete provider instructions from workspace startup files.
Private recovery backups live outside the active workspace and survive uninstall. Removal does not
reactivate obsolete instructions. restore-workspace explicitly recovers a backup, preserving later edits.
Historical conversations and ordinary project notes are preserved. Existing chats retain their history;
start a new conversation to test the restored memory provider without earlier discussion of Context Use.
Removal rebuilds local memory's index and requests a gateway refresh. Existing memory import is outside this version.

Development checks: test, check:types, and test:e2e in this package.
The e2e test needs Chrome and OPENCLAW_TEST_NODE pointing to supported Node. It creates a
fresh app and OpenClaw profile, uses a virtual passkey and real MCP, and scripts only model
responses. It checks integration, not live-model memory quality. No personal account is used.`;

async function main(args: string[]): Promise<void> {
  const [command, argument, agentId = 'main'] = args;
  if (!command || command === '--help') {
    console.log(usage);
    return;
  }
  await checkHost();
  const directory = connectionDirectory();
  switch (command) {
    case 'connect': {
      if (!argument) {
        throw new ConnectionError(usage);
      }
      PluginConfigSchema.shape.agentId.parse(agentId);
      await install();
      const result = await connect({ directory, instance: argument, agentId });
      if (result.authorizationUrl) {
        console.log(
          `Open this URL on your own device and authorize Context Use:\n${result.authorizationUrl}\n\nChoose a client name you have not used for another connection. The final localhost page may fail to load; that is expected. Copy its full address and send it back. Finish with ${OPENCLAW_INSTALL_COMMAND} authorize <redirect-url-file|-> using a private file or stdin. Do not store the link or code as a memory.`,
        );
      } else {
        await verifyRuntime();
        console.log('Context Use connected.');
        await refreshGateway();
      }
      return;
    }
    case 'authorize': {
      if (!argument) {
        throw new ConnectionError(usage);
      }
      const redirectUrl = (
        await readFile(argument === '-' ? '/dev/stdin' : argument, 'utf8')
      ).trim();
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
    case 'refresh':
      await refreshGateway();
      return;
    case 'restore-workspace': {
      if (!argument) {
        throw new ConnectionError(usage);
      }
      const preserved = await withConnection({ directory, run: () => restoreWorkspace(argument) });
      console.log(
        `Workspace backup restored.${preserved.length ? ` Kept later edits: ${preserved.join(', ')}.` : ''}`,
      );
      return;
    }
    default:
      throw new ConnectionError(usage);
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
