import * as p from "@clack/prompts";
import { defineCommand } from "@parshjs/core";
import { z } from "zod";
import { readInfrastructure } from "../../../lifecycle.ts";
import { refreshNangoPipelineRuntime } from "../../../deploy.ts";
import { deployManagedNangoFunctions } from "../../../nango-integration-deployment.ts";
import { resolveSelectableIntegration, selectableIntegrations } from "../../../nango-integration-selection.ts";
import { createInternalNangoFetcher } from "../../../nango-internal.ts";
import { getNangoIntegration } from "../../../nango-integrations.ts";
import { ensureNangoApiKeys } from "../../../nango.ts";

export const command = defineCommand("nango integrations deploy", {
  description: "Deploy the managed Nango integration functions from this Context Use release.",
  options: {
    integration: {
      schema: z.string().optional(),
      description: `Deploy only this integration (${selectableIntegrations().map((candidate) => candidate.id).join(", ")}).`,
    },
    "allow-destructive": {
      schema: z.boolean().optional(),
      description: "Allow an explicitly reviewed destructive Nango model change.",
    },
  },
  handler: async ({ options }) => {
    const requested = options.integration
      ? [resolveSelectableIntegration(options.integration)]
      : selectableIntegrations();
    const { config, root, data, compute } = await readInfrastructure();
    if (!data || !compute) throw new Error("No active deployment");
    await ensureNangoApiKeys(config, data, compute.instance_id);
    await refreshNangoPipelineRuntime(config, compute);

    const managerKey = "";
    const baseUrl = `https://${config.nangoHostname}`;
    const nango = { fetcher: createInternalNangoFetcher(config, data, compute.instance_id, "integration-manager") };

    // Deploying every integration is a maintenance action, so an integration the
    // user never added is skipped rather than treated as an error. Naming one
    // explicitly is a direct request, so a missing one still fails.
    const deployable: string[] = [];
    for (const integration of requested) {
      const configured = await getNangoIntegration(baseUrl, managerKey, integration.id, nango);
      if (!configured) {
        if (options.integration) {
          throw new Error(`Nango integration ${integration.id} is not configured; run \`context-use nango integrations add\``);
        }
        p.log.info(`Skipping ${integration.displayName}: not configured`);
        continue;
      }
      if (configured.provider !== integration.provider) {
        throw new Error(`Nango integration ${integration.id} uses provider ${configured.provider}; expected ${integration.provider}`);
      }
      deployable.push(integration.id);
    }

    if (deployable.length === 0) {
      throw new Error("No managed Nango integrations are configured; run `context-use nango integrations add`");
    }

    const progress = p.spinner();
    progress.start("Deploying managed Nango functions");
    try {
      const results = await deployManagedNangoFunctions(config, root, compute.instance_id, {
        integrationIds: deployable,
        allowDestructive: options["allow-destructive"] ?? false,
      });
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
