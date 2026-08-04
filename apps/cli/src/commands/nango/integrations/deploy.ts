import * as p from "@clack/prompts";
import { defineCommand } from "@parshjs/core";
import { z } from "zod";
import { MANAGED_INTEGRATIONS } from "../../../../../../nango-integrations/catalog.ts";
import { getSecureParameter } from "../../../aws.ts";
import { readInfrastructure } from "../../../lifecycle.ts";
import { refreshNangoPipelineRuntime } from "../../../deploy.ts";
import { deployManagedNangoFunctions } from "../../../nango-integration-deployment.ts";
import { getNangoIntegration } from "../../../nango-integrations.ts";
import { ensureNangoApiKeys } from "../../../nango.ts";

export const command = defineCommand("nango integrations deploy", {
  description: "Deploy the managed Nango integration functions from this Context Use release.",
  options: {
    "allow-destructive": {
      schema: z.boolean().optional(),
      description: "Allow an explicitly reviewed destructive Nango model change.",
    },
  },
  handler: async ({ options }) => {
    const { config, root, data, compute } = await readInfrastructure();
    if (!data || !compute) throw new Error("No active deployment");
    await ensureNangoApiKeys(config, data);
    await refreshNangoPipelineRuntime(config, compute);

    const prefix = `/context-use/${config.installationId}/${config.environment}`;
    const managerKey = await getSecureParameter(
      config.awsProfile,
      config.awsRegion,
      `${prefix}/NANGO_INTEGRATION_MANAGER_API_KEY`,
    );
    const baseUrl = `https://${config.nangoHostname}`;
    for (const integration of MANAGED_INTEGRATIONS.filter((candidate) => !("hidden" in candidate && candidate.hidden))) {
      const configured = await getNangoIntegration(baseUrl, managerKey, integration.id);
      if (!configured) {
        throw new Error(`Nango integration ${integration.id} is not configured; run \`context-use nango integrations add\``);
      }
      if (configured.provider !== integration.provider) {
        throw new Error(`Nango integration ${integration.id} uses provider ${configured.provider}; expected ${integration.provider}`);
      }
    }

    const progress = p.spinner();
    progress.start("Deploying managed Nango functions");
    try {
      const results = await deployManagedNangoFunctions(
        config,
        root,
        compute.instance_id,
        options["allow-destructive"] ?? false,
      );
      progress.stop("Managed Nango functions deployed");
      for (const result of results) {
        const output = result.output.trim();
        if (output) p.note(output, `${result.integrationId}/${result.functionName}`);
      }
    } catch (error) {
      progress.stop("Managed Nango function deployment failed");
      throw error;
    }
  },
});
