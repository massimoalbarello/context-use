import * as p from "@clack/prompts";
import { defineCommand } from "@parshjs/core";
import { z } from "zod";
import { readInfrastructure } from "../../../lifecycle.ts";
import { refreshNangoPipelineRuntime } from "../../../deploy.ts";
import { deployManagedNangoFunctions } from "../../../nango-integration-deployment.ts";
import {
  dashboardProviderLabel,
  type ManagedIntegration,
  requiresDashboardSetup,
  resolveSelectableIntegration,
  selectableIntegrations,
  usesStaticOAuth,
} from "../../../nango-integration-selection.ts";
import { createInternalNangoFetcher } from "../../../nango-internal.ts";
import { getNangoIntegration, reconcileNangoIntegration, type OAuthClientCredentials } from "../../../nango-integrations.ts";
import { ensureNangoApiKeys } from "../../../nango.ts";

async function promptCredential(message: string, secret = false): Promise<string> {
  const prompt = {
    message,
    validate: (input: string | undefined) => input?.trim() ? undefined : "Required",
  };
  const result = secret ? await p.password(prompt) : await p.text(prompt);
  if (p.isCancel(result)) throw new Error("Nango integration setup cancelled");
  if (!result?.trim()) throw new Error(`${message} is required`);
  return result.trim();
}

async function selectIntegration(id: string | undefined): Promise<ManagedIntegration> {
  if (id) return resolveSelectableIntegration(id);
  const choices: Array<{ value: string; label: string; hint?: string }> = selectableIntegrations()
    .map((integration) => ({
      value: integration.id,
      label: integration.displayName,
      ...(requiresDashboardSetup(integration) ? { hint: "requires dashboard setup first" } : {}),
    }));
  const selected = await p.select({ message: "Which integration do you want to add?", options: choices });
  if (p.isCancel(selected)) throw new Error("Nango integration setup cancelled");
  return resolveSelectableIntegration(selected);
}

function printDeploymentOutput(results: Awaited<ReturnType<typeof deployManagedNangoFunctions>>): void {
  for (const result of results) {
    const output = result.output.trim();
    if (output) p.note(output, `${result.integrationId}/${result.functionName}`);
  }
}

export const command = defineCommand("nango integrations add", {
  description: "Configure one managed Nango integration and deploy its syncs.",
  options: {
    integration: {
      schema: z.string().optional(),
      description: `Integration to add (${selectableIntegrations().map((candidate) => candidate.id).join(", ")}).`,
    },
    reconfigure: {
      schema: z.boolean().optional(),
      description: "Replace the existing OAuth client credentials.",
    },
  },
  handler: async ({ options }) => {
    const { config, root, data, compute } = await readInfrastructure();
    if (!data || !compute) throw new Error("No active deployment");

    p.intro("Add a managed Nango integration");
    const integration = await selectIntegration(options.integration);

    await ensureNangoApiKeys(config, data, compute.instance_id);
    await refreshNangoPipelineRuntime(config, compute);

    const managerKey = "";
    const baseUrl = `https://${config.nangoHostname}`;
    const nango = { fetcher: createInternalNangoFetcher(config, data, compute.instance_id, "integration-manager") };

    const existing = await getNangoIntegration(baseUrl, managerKey, integration.id, nango);
    if (existing && existing.provider !== integration.provider) {
      throw new Error(
        `Nango integration ${integration.id} uses provider ${existing.provider}; expected ${integration.provider}. `
        + "Resolve the conflict in the Nango dashboard before continuing.",
      );
    }

    if (requiresDashboardSetup(integration) && !existing) {
      throw new Error(
        `Create the ${integration.displayName} integration in the Nango dashboard first: `
        + `choose provider ${dashboardProviderLabel(integration)}, set the integration ID to ${integration.id}, `
        + "and then rerun this command. "
        + "Nango's public integration API does not perform MCP dynamic client registration.",
      );
    }

    let credentials: OAuthClientCredentials | undefined;
    if (usesStaticOAuth(integration) && (!existing || options.reconfigure)) {
      p.log.info(
        `Register this OAuth callback URL in your ${integration.displayName} OAuth app:\n`
        + `https://${config.nangoHostname}/oauth/callback`,
      );
      credentials = {
        clientId: await promptCredential(`${integration.displayName} OAuth client ID`),
        clientSecret: await promptCredential(`${integration.displayName} OAuth client secret`, true),
      };
    }

    const configureProgress = p.spinner();
    configureProgress.start(`Configuring ${integration.displayName} in Nango`);
    try {
      const result = await reconcileNangoIntegration(baseUrl, managerKey, integration, credentials, nango);
      configureProgress.stop(`${integration.displayName} integration ${result.outcome}`);
    } catch (error) {
      configureProgress.stop(`${integration.displayName} integration failed`);
      throw error;
    }

    const deployProgress = p.spinner();
    deployProgress.start(`Deploying ${integration.displayName} Nango syncs`);
    try {
      const results = await deployManagedNangoFunctions(config, root, compute.instance_id, {
        integrationIds: [integration.id],
      });
      deployProgress.stop(`${integration.displayName} Nango syncs deployed`);
      printDeploymentOutput(results);
    } catch (error) {
      deployProgress.stop(`${integration.displayName} Nango sync deployment failed`);
      throw error;
    }

    p.outro(
      `Open https://${config.nangoHostname} and authorize a ${integration.displayName} connection. `
      + "Run this command again to add another integration.",
    );
  },
});
