import metadata from '../package.json';

// This browser-safe entry point owns the public setup contract used by Settings.
export const OPENCLAW_PACKAGE = `${metadata.name}@${metadata.publishConfig.tag}`;
export const OPENCLAW_NPM_URL = `https://www.npmjs.com/package/${metadata.name}`;
export const OPENCLAW_REQUIREMENT = metadata.peerDependencies.openclaw;
export const OPENCLAW_INSTALL_COMMAND = `npx --yes ${OPENCLAW_PACKAGE}`;

export function openclawSetupPrompt(serverUrl: string): string {
  return `Install ${OPENCLAW_PACKAGE} and connect it to ${serverUrl} as my sole durable personal memory. Keep my conversations separate.

First run ${OPENCLAW_INSTALL_COMMAND} instructions and follow the setup skill it prints.`;
}
