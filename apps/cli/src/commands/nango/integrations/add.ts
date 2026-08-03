import * as p from "@clack/prompts";
import { defineCommand } from "@parshjs/core";
import { z } from "zod";
import { MANAGED_INTEGRATIONS } from "../../../../../../nango-integrations/catalog.ts";
import { getSecureParameter } from "../../../aws.ts";
import { readInfrastructure } from "../../../lifecycle.ts";
import { refreshNangoPipelineRuntime } from "../../../deploy.ts";
import { deployManagedNangoFunctions } from "../../../nango-integration-deployment.ts";
import { getNangoIntegration, reconcileNangoIntegration, type GitHubOAuthCredentials } from "../../../nango-integrations.ts";
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

function printDeploymentOutput(results: Awaited<ReturnType<typeof deployManagedNangoFunctions>>): void {
  for (const result of results) {
    const output = result.output.trim();
    if (output) p.note(output, `${result.integrationId}/${result.functionName}`);
  }
}

export const command = defineCommand("nango integrations add", {
  description: "Configure managed Nango integrations and deploy their syncs.",
  options: {
    reconfigure: {
      schema: z.boolean().optional(),
      description: "Replace the existing GitHub OAuth client credentials.",
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

    p.intro("Add managed Nango integrations");
    p.log.info(`Register this OAuth callback URL in your GitHub OAuth app:\nhttps://${config.nangoHostname}/oauth/callback`);

    for (const integration of MANAGED_INTEGRATIONS.filter((candidate) => !("hidden" in candidate && candidate.hidden))) {
      const existing = await getNangoIntegration(baseUrl, managerKey, integration.id);
      if (existing && existing.provider !== integration.provider) {
        throw new Error(
          `Nango integration ${integration.id} uses provider ${existing.provider}; expected ${integration.provider}. `
          + "Resolve the conflict in the Nango dashboard before continuing.",
        );
      }

      if ("setup" in integration && integration.setup === "manual" && !existing) {
        throw new Error(
          `Create the ${integration.displayName} integration in the Nango dashboard first: `
          + `choose provider Granola (MCP), set the integration ID to ${integration.id}, and then rerun this command. `
          + "Nango's public integration API does not perform MCP dynamic client registration.",
        );
      }

      let credentials: GitHubOAuthCredentials | undefined;
      if ("oauth" in integration && (!existing || options.reconfigure)) {
        credentials = {
          clientId: await promptCredential(`${integration.displayName} OAuth client ID`),
          clientSecret: await promptCredential(`${integration.displayName} OAuth client secret`, true),
        };
      }

      const progress = p.spinner();
      progress.start(`Configuring ${integration.displayName} in Nango`);
      try {
        const result = await reconcileNangoIntegration(baseUrl, managerKey, integration, credentials);
        progress.stop(`${integration.displayName} integration ${result.outcome}`);
      } catch (error) {
        progress.stop(`${integration.displayName} integration failed`);
        throw error;
      }
    }

    const progress = p.spinner();
    progress.start("Deploying managed Nango syncs");
    try {
      const results = await deployManagedNangoFunctions(config, root, compute.instance_id);
      progress.stop("Managed Nango syncs deployed");
      printDeploymentOutput(results);
    } catch (error) {
      progress.stop("Managed Nango sync deployment failed");
      throw error;
    }

    p.outro(
      `Open https://${config.nangoHostname} and authorize connections for GitHub and Granola. `
      + "Granola must use the dashboard-created granola-mcp integration so Nango performs dynamic client registration.",
    );
  },
});
