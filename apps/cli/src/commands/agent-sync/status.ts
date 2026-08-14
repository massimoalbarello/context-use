import { defineCommand } from "@parshjs/core";

import { readAgentSyncConfig, readAgentSyncToken } from "../../agent-sync/config.ts";
import { launchAgentLoaded } from "../../agent-sync/launchd.ts";
import { agentSyncSourcesPath } from "../../agent-sync/paths.ts";
import { probeAgentSync } from "../../agent-sync/remote.ts";
import { readAgentSyncSourceRoots } from "../../agent-sync/source-config.ts";
import { AgentSyncState } from "../../agent-sync/state.ts";

export const command = defineCommand("agent-sync status", {
  description: "Show local daemon, outbox, and Nango registration status.",
  options: {},
  handler: async () => {
    const config = await readAgentSyncConfig();
    const token = await readAgentSyncToken();
    const sourceRoots = await readAgentSyncSourceRoots();
    if (!config || !token) {
      console.log(JSON.stringify({
        state: "not-installed",
        sourceConfigPath: agentSyncSourcesPath,
        sourceRoots,
      }, null, 2));
      return;
    }
    const [daemon, remote] = await Promise.all([
      launchAgentLoaded(),
      probeAgentSync(config.webhookUrl, token, config.connectionId).catch(() => false),
    ]);
    const state = await AgentSyncState.open();
    const summary = state.summary();
    state.close();
    console.log(JSON.stringify({
      state: daemon && remote ? "healthy" : "unhealthy",
      connectionId: config.connectionId,
      instanceId: config.schemaVersion === 2 ? config.instanceId : null,
      label: config.label,
      deploymentId: config.deploymentId,
      installedAt: config.installedAt,
      sourceConfigPath: agentSyncSourcesPath,
      sourceRoots,
      daemonLoaded: daemon,
      nangoRegistered: remote,
      ...summary,
    }, null, 2));
  },
});
