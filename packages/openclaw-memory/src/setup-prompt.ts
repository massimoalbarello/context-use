import metadata from '../package.json';

// This browser-safe entry point owns the public setup contract used by Settings.
export const OPENCLAW_PACKAGE = `${metadata.name}@${metadata.publishConfig.tag}`;
export const OPENCLAW_NPM_URL = `https://www.npmjs.com/package/${metadata.name}`;
export const OPENCLAW_REQUIREMENT = metadata.peerDependencies.openclaw;
export const OPENCLAW_INSTALL_COMMAND = `npx --yes ${OPENCLAW_PACKAGE}`;

export function openclawConnectCommand(serverUrl: string): string {
  return `${OPENCLAW_INSTALL_COMMAND} connect '${serverUrl.replaceAll("'", "'\\''")}'`;
}

export function openclawSetupPrompt(serverUrl: string): string {
  return `Install Context Use as my sole durable personal memory in this OpenClaw agent. Keep my conversations separate.

Check openclaw --version first (requires ${OPENCLAW_REQUIREMENT}), then run:
${openclawConnectCommand(serverUrl)}

Follow the plugin's instructions: give me the authorization URL and ask me to return the final localhost redirect URL. When I send it back, finish connecting. Let the plugin manage configuration and gateway refresh.

After authorization, tell me to start a new session with /new so the gateway can finish applying the memory settings. Verify openclaw context-use status in that new session before confirming that memory is active.`;
}

export const OPENCLAW_REMOVAL_PROMPT = `Remove the Context Use memory plugin using ${OPENCLAW_INSTALL_COMMAND} remove in this OpenClaw profile. This also works if authorization was never completed or the plugin is disabled. Let the plugin restore its configuration changes, clear its credentials and refresh the gateway. Preserve my remote memories and conversation history. Removal runs separately: end this turn once it is queued, then check ${OPENCLAW_INSTALL_COMMAND} status in a new turn. Do not poll from the requesting turn, schedule retries, stop the gateway, or reinstall to finish removal. Verify that a fresh conversation uses the restored memory provider.`;

export function openclawReconnectPrompt(serverUrl: string): string {
  return `Reauthorize my Context Use memory plugin for ${serverUrl}. Run ${OPENCLAW_INSTALL_COMMAND} reconnect '${serverUrl.replaceAll("'", "'\\''")}' in the same OpenClaw profile. Give me the new authorization URL and ask me to return the final localhost redirect URL. Pass that URL to ${OPENCLAW_INSTALL_COMMAND} authorize through standard input. Let the plugin manage configuration and gateway refresh. After authorization, tell me to start a new session with /new, then verify status in that new session before confirming that memory is active.`;
}
