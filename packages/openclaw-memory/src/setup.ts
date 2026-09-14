#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { connect, disconnect, finishAuthorization, status } from './connection';
import { PLUGIN_ID, PluginConfigSchema } from './contract';
import { ConnectionError } from './error';
import { checkHost, openclaw, verifyRuntime } from './host';
import { install } from './install';
import { connectionDirectory } from './state';

const usage = `context-use-openclaw connect <instance-url> [agent-id=main] [--personal-group <session-key>]...
context-use-openclaw authorize <redirect-url-file|->
context-use-openclaw status
context-use-openclaw disconnect
context-use-openclaw remove

Authorize reads the pasted redirect URL from a private file or stdin, keeping the code out of process arguments.
Use the same OpenClaw profile environment for every command.

From the repository: bun install, then bun run --cwd packages/openclaw-memory build.
Run this helper with Node from packages/openclaw-memory/pkg/dist/setup.js.
The publishable package is pkg/; it has not been published.

Connect installs the local package and configures the memory slot, tools and Active Memory.
The owner opens the authorization link on any device, uses their passkey, and sends back
its final localhost callback address. A failed localhost page is expected; no listener is needed.
An authorized OpenClaw agent can perform setup itself; only passkey authorization needs the owner.
After authorize, delete the temporary callback file and restart the OpenClaw gateway.
Once active, these commands are also available as openclaw context-use <command>.

This version supports one personal agent and one Context Use account across separate personal conversations.
Setup preserves your existing conversation/session scope.
Direct conversations work automatically. For a private group used only by the owner and agent,
pass --personal-group with its base session key (all topics), or its exact topic session key.
An agent performing setup can use its current session key; only include groups the owner has
confirmed are personal. Group members can see recalled information. Other groups stay excluded.
Disconnect restores setup-owned settings while preserving later edits and remote memories.
Use remove for credential cleanup and uninstall; native disable alone retains connection state.
Restart the gateway after disconnect/remove. Existing memory import is outside this version.

Development checks: test, check:types, and test:e2e in this package.
The e2e test needs Chrome and OPENCLAW_TEST_NODE pointing to supported Node. It creates a
fresh app and OpenClaw profile, uses a virtual passkey and real MCP, and scripts only model
responses. It checks integration, not live-model memory quality. No personal account is used.`;

async function main(args: string[]): Promise<void> {
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      'personal-group': { type: 'string', multiple: true },
      help: { type: 'boolean' },
    },
  });
  const [command, argument, agentId = 'main'] = positionals;
  if (!command || values.help) {
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
      const personalGroupSessions = PluginConfigSchema.shape.personalGroupSessions.parse(
        values['personal-group'],
      );
      await install();
      const result = await connect({
        directory,
        instance: argument,
        agentId,
        personalGroupSessions,
      });
      if (result.authorizationUrl) {
        console.log(
          `Open this URL on your own device and authorize Context Use:\n${result.authorizationUrl}\n\nThe final localhost page may fail to load; that is expected. Copy its full address and send it back. Finish with authorize using a private file or stdin. Do not store the link or code as a memory.`,
        );
      } else {
        await verifyRuntime();
        console.log(
          'Context Use connected. Restart the OpenClaw gateway to apply the memory configuration.',
        );
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
      console.log(
        'Context Use connected. Restart the OpenClaw gateway to apply the memory configuration.',
      );
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
      const preserved = await disconnect(directory);
      console.log(
        `Disconnected. Remote memories are preserved.${preserved.length ? ` Kept user edits: ${preserved.join(', ')}.` : ''}`,
      );
      if (command === 'remove') {
        console.log(await openclaw(['plugins', 'uninstall', PLUGIN_ID, '--force']));
      }
      console.log('Restart the OpenClaw gateway to apply restored settings.');
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
