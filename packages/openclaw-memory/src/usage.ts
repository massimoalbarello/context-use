export const SETUP_USAGE = `context-use-openclaw connect <instance-url> [agent-id=main]
context-use-openclaw reconnect [instance-url] [agent-id]
context-use-openclaw authorize
context-use-openclaw status
context-use-openclaw disconnect
context-use-openclaw remove [--wait]
context-use-openclaw refresh

Connect installs the plugin and starts browser authorization. Pass the returned URL to authorize
through standard input. After installation, these commands also work through openclaw context-use.
Reconnect starts fresh authorization, using the saved URL when omitted. Connect with a different URL
also starts fresh authorization. Use the same OpenClaw profile for every command. Remove restores your settings and uninstalls the
plugin while preserving remote memories and conversation history. Remove runs in the background: end
the requesting agent turn, then check status in a new turn. Use --wait only from a terminal outside
an agent turn. Status, remove and refresh also work after uninstall through the npm helper.`;
