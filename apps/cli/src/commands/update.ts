import * as p from "@clack/prompts";
import { defineCommand } from "@parshjs/core";
import { z } from "zod";
import { sendSsmCommands } from "../aws.ts";
import { continueUpdateWithCli, installCliRelease } from "../cli-update.ts";
import { deploy } from "../deploy.ts";
import { readConfigIfPresent, saveConfig } from "../paths.ts";
import { currentVersion, deploymentRoot, releaseManifest } from "../release.ts";
import { applyCompute, applyData, assertTerraformVersion, currentComputeOutputs } from "../terraform.ts";

export const command = defineCommand("update", {
  description: "Update the CLI and deployed release.",
  options: {
    version: {
      schema: z.string().default("latest"),
      description: "Release to install.",
    },
  },
  handler: async ({ options }) => {
    const manifest = await releaseManifest(options.version);
    if (currentVersion !== manifest.version) {
      const executable = await installCliRelease(manifest);
      p.log.success(`Updated CLI to ${manifest.version}`);
      await continueUpdateWithCli(executable, manifest.version);
      return;
    }

    const config = await readConfigIfPresent();
    if (!config?.computeOutputs) {
      p.log.info("No active context-use deployment; skipping deployment update");
      p.outro(`CLI is at ${manifest.version}`);
      return;
    }
    await assertTerraformVersion(manifest);
    const root = await deploymentRoot(manifest);

    config.computeOutputs = await currentComputeOutputs(root, config);
    await saveConfig(config);
    await sendSsmCommands(config.awsProfile, config.awsRegion, config.computeOutputs.instance_id, [
      "cd /opt/context-use/deploy && docker compose --env-file /data/context-use/secrets/runtime.env run --rm backup once",
    ]);

    config.dataOutputs = await applyData(root, config);
    await saveConfig(config);
    config.computeOutputs = await applyCompute(root, config);
    await saveConfig(config);
    try {
      await deploy(config, manifest);
    } catch (error) {
      p.log.error("Update health checks failed; rolling back the application images");
      const previous = await releaseManifest(config.releaseVersion);
      await deploy(config, previous);
      throw error;
    }
    config.releaseVersion = manifest.version;
    config.phase = "deployed";
    await saveConfig(config);
    p.outro(`Updated to ${manifest.version}`);
  },
});
