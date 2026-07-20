import * as p from "@clack/prompts";
import { defineCommand } from "@parshjs/core";
import { bootstrapStateBucket, sendSsmCommands } from "../aws.ts";
import { continueUpdateWithCli, installCliRelease } from "../cli-update.ts";
import { retainedDataVolumeExists } from "../data-volume.ts";
import { deploy, deployedRuntimePresent, prepareCompute } from "../deploy.ts";
import { readConfigIfPresent, saveConfig } from "../paths.ts";
import { currentVersion, deploymentRoot, releaseManifest } from "../release.ts";
import { ensureRuntimeParameters } from "../setup.ts";
import { applyCompute, applyData, assertTerraformVersion, currentComputeOutputs, currentDataOutputs } from "../terraform.ts";

export const command = defineCommand("update", {
  description: "Update the CLI and deployment to the latest release.",
  options: {},
  handler: async () => {
    const manifest = await releaseManifest(process.env.CONTEXT_USE_UPDATE_CONTINUATION === "1" ? currentVersion : "latest");
    if (currentVersion !== manifest.version) {
      const executable = await installCliRelease(manifest);
      p.log.success(`Updated CLI to ${manifest.version}`);
      await continueUpdateWithCli(executable, manifest.version);
      return;
    }

    const config = await readConfigIfPresent();
    if (!config) {
      p.log.info("No active context-use deployment; skipping deployment update");
      p.outro(`CLI is at ${manifest.version}`);
      return;
    }
    if (config.recovery) throw new Error("Volume recovery is in progress; run `context-use recover`");
    await assertTerraformVersion(manifest);
    const root = await deploymentRoot(manifest);
    await bootstrapStateBucket(config.awsProfile, config.awsRegion, config.stateBucket);

    const [existingData, existingCompute] = await Promise.all([
      currentDataOutputs(root, config),
      currentComputeOutputs(root, config),
    ]);
    if (existingData && !await retainedDataVolumeExists(config, existingData)) {
      throw new Error("The retained data volume is missing; run `context-use recover`");
    }
    if (!existingCompute) {
      p.log.info("No active context-use deployment; skipping deployment update");
      p.outro(`CLI is at ${manifest.version}`);
      return;
    }
    if (!existingData) throw new Error("Retained data state is missing; refusing to update active compute");
    if (await deployedRuntimePresent(config, existingCompute)) {
      await sendSsmCommands(config.awsProfile, config.awsRegion, existingCompute.instance_id, [
        "cd /opt/context-use/deploy && docker compose --env-file /data/context-use/secrets/runtime.env run --rm backup once",
      ]);
    }

    const data = await applyData(root, config);
    const compute = await applyCompute(root, config, data);
    await prepareCompute(config, data, compute);
    await ensureRuntimeParameters(config, data, compute);
    await deploy(config, compute, manifest);
    config.releaseVersion = manifest.version;
    await saveConfig(config);
    p.outro(`Updated to ${manifest.version}`);
  },
});
