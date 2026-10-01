import { OPENCLAW_INSTALL_COMMAND, OPENCLAW_REQUIREMENT } from './setup-prompt';

// The npm helper and bundled skill expose the same lifecycle instructions.
export const SETUP_SKILL = `---
name: context-use
description: Set up, reauthorize, inspect, or remove Context Use personal memory in OpenClaw.
---

# Manage Context Use memory

Use the same OpenClaw profile for every command. Check openclaw --version first;
this plugin requires ${OPENCLAW_REQUIREMENT}. Let the helper manage configuration
and gateway refresh. Do not enable the plugin, select a memory slot, or edit
configuration manually. The helper activates the plugin only after verifying memory access.

## Connect

Ask for the user's Context Use instance URL if it was not supplied. Never guess it.
Run ${OPENCLAW_INSTALL_COMMAND} connect '<instance-url>'. This installs the plugin
and starts authorization without activating it as the memory provider yet.
For an agent other than main, append its agent ID. This plugin supports one personal agent per profile.

Give the user the authorization URL. Ask them to authorize in their browser and
send back the final localhost redirect URL, even if that page does not load.
Pass that URL to ${OPENCLAW_INSTALL_COMMAND} authorize through standard input,
not as a command argument. Treat authorization URLs and codes as credentials;
do not save them as memories.

After authorization, ask the user to start a new session with /new so the gateway
can apply the settings. In that session, run ${OPENCLAW_INSTALL_COMMAND} status.
Confirm memory is active only when connected is true. If activation is pending,
follow the command output; do not force-stop the gateway.

## Reauthorize

Run ${OPENCLAW_INSTALL_COMMAND} reconnect. It uses the saved instance URL and agent.
To move to another instance, append the new URL. Follow the authorization and
new-session verification steps above.

## Remove

Run ${OPENCLAW_INSTALL_COMMAND} remove. It restores the plugin's configuration
changes, clears local credentials, cancels unfinished learning, discards pending
local evidence, and uninstalls the package. User edits, remote memories, and
conversation history are preserved. It also works when setup was unfinished or disabled.

Removal runs separately so the requesting turn can finish. End this turn once
removal is queued. Do not poll in this turn, schedule retries, stop the gateway,
or reinstall the plugin to finish removal. In a new turn, run
${OPENCLAW_INSTALL_COMMAND} status. Confirm removal only when installed is false
and no removal operation remains. Verify a fresh
conversation uses the restored memory provider. Use remove --wait only in a
terminal outside an agent turn.

## Inspect or recover

Run ${OPENCLAW_INSTALL_COMMAND} status and follow its output. The npm helper works
even when the plugin is disabled or uninstalled. Run
${OPENCLAW_INSTALL_COMMAND} instructions to read this skill again.
`;
