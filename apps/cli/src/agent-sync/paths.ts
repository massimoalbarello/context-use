import { homedir } from "node:os";
import { resolve } from "node:path";

export const agentSyncDirectory = resolve(homedir(), ".config/context-use/agent-sync");
export const agentSyncConfigPath = resolve(agentSyncDirectory, "config.json");
export const agentSyncCredentialPath = resolve(agentSyncDirectory, "credential");
export const agentSyncStatePath = resolve(agentSyncDirectory, "state.sqlite");
export const agentSyncLockPath = resolve(agentSyncDirectory, "run.lock");
export const agentSyncLogDirectory = resolve(agentSyncDirectory, "logs");

export const launchAgentLabel = "dev.context-use.agent-sync";
export const launchAgentPath = resolve(
  homedir(),
  "Library/LaunchAgents",
  `${launchAgentLabel}.plist`,
);
