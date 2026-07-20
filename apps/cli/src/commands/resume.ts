import * as p from "@clack/prompts";
import { defineCommand } from "@parshjs/core";
import { bootstrapStateBucket } from "../aws.ts";
import { retainedDataVolumeExists } from "../data-volume.ts";
import { deploy, prepareCompute } from "../deploy.ts";
import { readConfig } from "../paths.ts";
import { deploymentRoot, releaseManifest } from "../release.ts";
import { ensureRuntimeParameters, ownerSetupUrl, pauseForManualDns } from "../setup.ts";
import { applyCompute, applyData, assertTerraformVersion, currentComputeOutputs, currentDataOutputs } from "../terraform.ts";

export const command = defineCommand("resume", {
  description: "Continue an interrupted setup.",
  options: {},
  handler: async () => {
    const config = await readConfig();
    if (config.recovery) throw new Error("Volume recovery is in progress; run `context-use recover`");
    const manifest = await releaseManifest(config.releaseVersion);
    await assertTerraformVersion(manifest);
    const root = await deploymentRoot(manifest);
    await bootstrapStateBucket(config.awsProfile, config.awsRegion, config.stateBucket);
    const [existingData, existingCompute] = await Promise.all([
      currentDataOutputs(root, config),
      currentComputeOutputs(root, config),
    ]);
    if (existingCompute && !existingData) {
      throw new Error("Retained data state is missing; refusing to resume active compute");
    }
    if (existingData && !await retainedDataVolumeExists(config, existingData)) {
      throw new Error("The retained data volume is missing; run `context-use recover`");
    }
    const data = await applyData(root, config);
    const compute = existingCompute ?? await applyCompute(root, config, data, true);
    await prepareCompute(config, data, compute);
    await ensureRuntimeParameters(config, data, compute);
    if (await pauseForManualDns(config, compute)) return;
    await deploy(config, compute, manifest);
    p.outro(`context-use is ready. Create the owner passkey:\n${await ownerSetupUrl(config)}`);
  },
});
