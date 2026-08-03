import * as p from "@clack/prompts";
import { defineCommand } from "@parshjs/core";
import { hostname } from "node:os";

import { MANAGED_INTEGRATIONS } from "../../../../../nango-integrations/catalog.ts";
import { getSecureParameter } from "../../aws.ts";
import { writeAgentSyncConfig, readAgentSyncConfig, readAgentSyncToken, writeAgentSyncToken } from "../../agent-sync/config.ts";
import { installLaunchAgent } from "../../agent-sync/launchd.ts";
import {
  activeAgentSyncMetadata,
  AGENT_SYNC_CONNECTION_ID,
  AGENT_SYNC_FUNCTION_NAME,
  AGENT_SYNC_INTEGRATION_ID,
  assertAgentSyncActivationAllowed,
  newAgentSyncToken,
  parseAgentSyncMetadata,
} from "../../agent-sync/registration.ts";
import { probeAgentSync } from "../../agent-sync/remote.ts";
import { runAgentSync } from "../../agent-sync/runtime.ts";
import { refreshNangoPipelineRuntime } from "../../deploy.ts";
import { readInfrastructure } from "../../lifecycle.ts";
import { deployManagedNangoFunction } from "../../nango-integration-deployment.ts";
import {
  getNangoConnection,
  getNangoIntegrationWebhookUrl,
  putAgentSyncConnection,
  reconcileNangoIntegration,
} from "../../nango-integrations.ts";
import { ensureNangoApiKeys } from "../../nango.ts";

export const command = defineCommand("agent-sync install", {
  description: "Install and register the local agent conversation sync.",
  options: {},
  handler: async () => {
    if (process.platform !== "darwin") throw new Error("Agent sync currently supports macOS only");
    const { config, root, data, compute } = await readInfrastructure();
    if (!data || !compute) throw new Error("No active deployment");
    const localConfig = await readAgentSyncConfig();
    if (localConfig && localConfig.deploymentId !== config.installationId) {
      throw new Error(
        `Agent sync is already installed for deployment ${localConfig.deploymentId}; uninstall it before installing for another deployment`,
      );
    }

    p.intro("Install agent sync");
    const progress = p.spinner();
    progress.start("Preparing the managed Nango ingestion endpoint");
    await ensureNangoApiKeys(config, data);
    await refreshNangoPipelineRuntime(config, compute);
    const managerKey = await getSecureParameter(
      config.awsProfile,
      config.awsRegion,
      `/context-use/${config.installationId}/${config.environment}/NANGO_INTEGRATION_MANAGER_API_KEY`,
    );
    const baseUrl = `https://${config.nangoHostname}`;
    const integration = MANAGED_INTEGRATIONS.find((candidate) => candidate.id === AGENT_SYNC_INTEGRATION_ID);
    if (!integration) throw new Error("The agent-sync integration is missing from this Context Use release");
    await reconcileNangoIntegration(baseUrl, managerKey, integration, undefined);
    await deployManagedNangoFunction(
      config,
      root,
      compute.instance_id,
      AGENT_SYNC_INTEGRATION_ID,
      AGENT_SYNC_FUNCTION_NAME,
    );
    const webhookUrl = await getNangoIntegrationWebhookUrl(
      baseUrl,
      managerKey,
      AGENT_SYNC_INTEGRATION_ID,
    );
    progress.stop("Managed Nango ingestion endpoint ready");

    const existing = await getNangoConnection(
      baseUrl,
      managerKey,
      AGENT_SYNC_INTEGRATION_ID,
      AGENT_SYNC_CONNECTION_ID,
    );
    const existingMetadata = parseAgentSyncMetadata(existing?.metadata);
    const localToken = await readAgentSyncToken();
    assertAgentSyncActivationAllowed({
      connectionExists: existing !== null,
      metadata: existingMetadata,
      localToken,
      deploymentId: config.installationId,
    });

    const token = localToken ?? newAgentSyncToken();
    const label = localConfig?.label ?? hostname();
    const installedAt = localConfig?.installedAt ?? new Date().toISOString();
    await writeAgentSyncToken(token);
    await writeAgentSyncConfig({
      schemaVersion: 1,
      deploymentId: config.installationId,
      connectionId: AGENT_SYNC_CONNECTION_ID,
      webhookUrl,
      installedAt,
      label,
    });
    await putAgentSyncConnection(
      baseUrl,
      managerKey,
      AGENT_SYNC_INTEGRATION_ID,
      AGENT_SYNC_CONNECTION_ID,
      activeAgentSyncMetadata({
        token,
        deploymentId: config.installationId,
        label,
        version: config.releaseVersion,
      }),
    );
    if (!await probeAgentSync(webhookUrl, token, AGENT_SYNC_CONNECTION_ID)) {
      throw new Error("Nango did not activate the agent-sync connection");
    }

    const result = await runAgentSync();
    await installLaunchAgent();
    p.outro(
      `Agent sync installed on ${label}; ${result.accepted} conversation${result.accepted === 1 ? "" : "s"} accepted in the initial run.`,
    );
  },
});
