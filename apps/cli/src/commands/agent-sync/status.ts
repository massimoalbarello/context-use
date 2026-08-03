import { defineCommand } from "@parshjs/core";

import { readAgentSyncConfig, readAgentSyncToken } from "../../agent-sync/config.ts";
import { launchAgentLoaded } from "../../agent-sync/launchd.ts";
import { probeAgentSync } from "../../agent-sync/remote.ts";
import { AgentSyncState } from "../../agent-sync/state.ts";

export const command = defineCommand("agent-sync status", {
  description: "Show local daemon, outbox, and Nango registration status.",
  options: {},
  handler: async () => {
    const config = await readAgentSyncConfig();
    const token = await readAgentSyncToken();
    if (!config || !token) {
      console.log(JSON.stringify({ state: "not-installed" }, null, 2));
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
      label: config.label,
      deploymentId: config.deploymentId,
      installedAt: config.installedAt,
      sourceRoots: config.sourceRoots,
      daemonLoaded: daemon,
      nangoRegistered: remote,
      ...summary,
    }, null, 2));
  },
});
