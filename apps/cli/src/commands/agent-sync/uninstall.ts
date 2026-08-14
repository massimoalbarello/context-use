import * as p from "@clack/prompts";
import { defineCommand } from "@parshjs/core";

import { readAgentSyncConfig, removeAgentSyncFiles } from "../../agent-sync/config.ts";
import { uninstallLaunchAgent } from "../../agent-sync/launchd.ts";
import {
  AGENT_SYNC_INTEGRATION_ID,
  parseAgentSyncMetadata,
  revokedAgentSyncMetadata,
} from "../../agent-sync/registration.ts";
import { readInfrastructure } from "../../lifecycle.ts";
import { createInternalNangoFetcher } from "../../nango-internal.ts";
import { getNangoConnection, putAgentSyncConnection } from "../../nango-integrations.ts";
import { ensureNangoApiKeys } from "../../nango.ts";

export const command = defineCommand("agent-sync uninstall", {
  description: "Revoke the Nango registration and remove the local daemon.",
  options: {},
  handler: async () => {
    const { config, data, compute } = await readInfrastructure();
    if (!data || !compute) throw new Error("No active deployment");
    const localConfig = await readAgentSyncConfig();
    if (!localConfig) throw new Error("Agent sync is not installed on this computer");
    if (localConfig.deploymentId !== config.installationId) {
      throw new Error(
        `The local agent sync belongs to deployment ${localConfig.deploymentId}; run uninstall from that deployment directory`,
      );
    }
    p.intro("Uninstall agent sync");
    await ensureNangoApiKeys(config, data, compute.instance_id);
    const managerKey = "";
    const baseUrl = `https://${config.nangoHostname}`;
    const nango = { fetcher: createInternalNangoFetcher(config, data, compute.instance_id, "integration-manager") };
    const connection = await getNangoConnection(
      baseUrl,
      managerKey,
      AGENT_SYNC_INTEGRATION_ID,
      localConfig.connectionId,
      nango,
    );
    const metadata = parseAgentSyncMetadata(connection?.metadata);
    if (connection && !metadata) {
      throw new Error("The Nango agent-sync connection has unrecognized metadata; inspect it in the Nango dashboard before revoking it");
    }
    if (metadata && metadata.deployment_id !== config.installationId) {
      throw new Error("The Nango agent-sync connection belongs to a different Context Use deployment");
    }
    if (metadata && localConfig.schemaVersion === 2 && metadata.instance_id !== localConfig.instanceId) {
      throw new Error("The Nango agent-sync connection belongs to a different local instance");
    }
    if (metadata) {
      await putAgentSyncConnection(
        baseUrl,
        managerKey,
        AGENT_SYNC_INTEGRATION_ID,
        localConfig.connectionId,
        revokedAgentSyncMetadata(metadata, config.releaseVersion),
        nango,
      );
    }
    await uninstallLaunchAgent();
    await removeAgentSyncFiles();
    p.outro("Agent sync revoked and removed. Nango records were retained.");
  },
});
