import * as p from "@clack/prompts";
import { defineCommand } from "@parshjs/core";
import { z } from "zod";
import { sendSsmCommands } from "../aws.ts";
import { deploy } from "../deploy.ts";
import { readConfig, saveConfig } from "../paths.ts";
import { deploymentRoot, releaseManifest } from "../release.ts";
import { applyCompute, applyData, assertTerraformVersion } from "../terraform.ts";

export const command = defineCommand("update", {
  description: "Back up and deploy a release.",
  options: {
    version: {
      schema: z.string().default("latest"),
      description: "Release to install.",
    },
  },
  handler: async ({ options }) => {
    const config = await readConfig();
    if (!config.computeOutputs) throw new Error("No active compute deployment");
    await sendSsmCommands(config.awsProfile, config.awsRegion, config.computeOutputs.instance_id, [
      "cd /opt/context-use/deploy && docker compose --env-file /data/context-use/secrets/runtime.env run --rm backup once",
    ]);
    const manifest = await releaseManifest(options.version);
    await assertTerraformVersion(manifest);
    const root = await deploymentRoot(manifest);
    config.dataOutputs = await applyData(root, config);
    config.computeOutputs = await applyCompute(root, config);
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
