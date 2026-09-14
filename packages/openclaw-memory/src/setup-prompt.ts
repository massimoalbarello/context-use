import metadata from '../package.json';

// This browser-safe entry point owns the public setup contract used by Settings.
export const OPENCLAW_PACKAGE = `${metadata.name}@${metadata.version}`;
export const OPENCLAW_REQUIREMENT = metadata.peerDependencies.openclaw;
export const OPENCLAW_INSTALL_COMMAND = `npx --yes ${OPENCLAW_PACKAGE}`;

export function openclawConnectCommand(serverUrl: string): string {
  return `${OPENCLAW_INSTALL_COMMAND} connect '${serverUrl.replaceAll("'", "'\\''")}'`;
}

export function openclawSetupPrompt(serverUrl: string): string {
  return `Install Context Use as my sole durable personal memory in this OpenClaw agent. Keep my conversations separate.

Check openclaw --version first (requires ${OPENCLAW_REQUIREMENT}), then run:
${openclawConnectCommand(serverUrl)}
Use this profile and append this agent's ID if it is not main.

Follow the plugin's instructions: give me the authorization URL and ask me to return the final localhost redirect URL. Complete authorization with ${OPENCLAW_INSTALL_COMMAND} authorize <redirect-url-file|-> using stdin or a private file, then delete the file. Let the plugin manage configuration and gateway refresh.

Verify openclaw context-use status and call context_use_search_hypermedia in the next agent turn before reporting success. Keep setup instructions out of workspace memory files.`;
}

export const OPENCLAW_REMOVAL_PROMPT =
  'Remove the Context Use memory plugin using openclaw context-use remove in this OpenClaw profile. Let the plugin clean up its configuration, credentials and obsolete workspace instructions, and refresh the gateway. Preserve my remote memories and conversation history. Verify that a fresh conversation uses the restored memory provider.';
