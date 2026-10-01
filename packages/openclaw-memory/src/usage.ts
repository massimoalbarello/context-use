import { OPENCLAW_INSTALL_COMMAND } from './setup-prompt';

export const SETUP_USAGE = `context-use-openclaw instructions
context-use-openclaw connect <instance-url> [agent-id=main]
context-use-openclaw reconnect [instance-url] [agent-id]
context-use-openclaw authorize
context-use-openclaw status
context-use-openclaw disconnect
context-use-openclaw remove [--wait]
context-use-openclaw refresh

Read the setup skill with ${OPENCLAW_INSTALL_COMMAND} instructions.
Connect installs the plugin and starts browser authorization. Reconnect uses the saved URL when
omitted. Pass the final redirect URL to authorize through standard input.
Remove restores settings, clears local credentials, cancels unfinished learning, and discards
pending local evidence. Remote memories and conversation history are preserved.
It runs in the background: end the agent turn, then check status in a new turn. Use --wait only
outside an agent turn. The openclaw context-use alias requires an active plugin.
Use the same OpenClaw profile throughout. The npm helper also works when disabled or uninstalled.`;
