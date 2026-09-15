export const SETUP_USAGE = `context-use-openclaw connect <instance-url> [agent-id=main]
context-use-openclaw authorize
context-use-openclaw status
context-use-openclaw disconnect
context-use-openclaw remove
context-use-openclaw refresh

Connect installs the plugin and starts browser authorization. Pass the returned URL to authorize
through standard input. After installation, these commands also work through openclaw context-use.
Use the same OpenClaw profile for every command. Remove restores your settings and uninstalls the
plugin while preserving remote memories. Refresh also works after uninstall.`;
