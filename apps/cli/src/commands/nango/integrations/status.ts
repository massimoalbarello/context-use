import * as p from "@clack/prompts";
import { defineCommand } from "@parshjs/core";
import { MANAGED_FUNCTIONS, MANAGED_INTEGRATIONS } from "../../../../../../nango-integrations/catalog.ts";
import { getSecureParameter } from "../../../aws.ts";
import { readInfrastructure } from "../../../lifecycle.ts";
import { readManagedIntegrationStatus, type ManagedIntegrationStatus } from "../../../nango-integrations.ts";

export function formatManagedIntegrationStatus(
  releaseVersion: string,
  status: ManagedIntegrationStatus,
): string {
  if (!status.configured) {
    return [
      "Integration: not configured",
      "Connections: 0",
      "Pull-request sync: not deployed",
    ].join("\n");
  }

  const connectionIds = status.connections.map((connection) => connection.connection_id);
  const deployedVersion = status.sync?.version ?? null;
  return [
    "Integration: configured",
    `Connections: ${connectionIds.length}${connectionIds.length > 0 ? ` (${connectionIds.join(", ")})` : ""}`,
    status.sync
      ? `Pull-request sync: deployed${status.sync.runs ? ` · ${status.sync.runs}` : ""}`
      : "Pull-request sync: not deployed",
    `Deployed release: ${deployedVersion ?? "unknown"}`,
    `Expected release: ${releaseVersion}`,
    `Release match: ${deployedVersion === releaseVersion ? "yes" : "no"}`,
    ...(status.sync?.last_deployed ? [`Last deployed: ${status.sync.last_deployed}`] : []),
  ].join("\n");
}

export const command = defineCommand("nango integrations status", {
  description: "Show GitHub integration, connection, and sync deployment status.",
  options: {},
  handler: async () => {
    const { config, data, compute } = await readInfrastructure();
    if (!data || !compute) throw new Error("No active deployment");
    const prefix = `/context-use/${config.installationId}/${config.environment}`;
    const managerKey = await getSecureParameter(
      config.awsProfile,
      config.awsRegion,
      `${prefix}/NANGO_INTEGRATION_MANAGER_API_KEY`,
    );
    const baseUrl = `https://${config.nangoHostname}`;

    for (const integration of MANAGED_INTEGRATIONS) {
      const managedFunction = MANAGED_FUNCTIONS.find((candidate) => candidate.integrationId === integration.id);
      if (!managedFunction) throw new Error(`No managed function is registered for ${integration.id}`);
      const status = await readManagedIntegrationStatus(
        baseUrl,
        managerKey,
        integration.id,
        managedFunction.name,
      );
      p.note(formatManagedIntegrationStatus(config.releaseVersion, status), integration.displayName);
    }
  },
});
