import * as p from "@clack/prompts";
import { defineCommand } from "@parshjs/core";
import { bootstrapStateBucket, configureStateBucketKms, createStateKmsKey } from "../aws.ts";
import { deploy } from "../deploy.ts";
import { readConfig, saveConfig } from "../paths.ts";
import { deploymentRoot, releaseManifest } from "../release.ts";
import { ownerSetupUrl, pauseForManualDns, storeRuntimeParameters } from "../setup.ts";
import { applyCompute, applyData, assertTerraformVersion } from "../terraform.ts";

export const command = defineCommand("resume", {
  description: "Continue an interrupted setup.",
  options: {},
  handler: async () => {
    const config = await readConfig();
    if (config.phase === "purged") {
      throw new Error("This installation was permanently purged; remove the local config before starting a new setup");
    }
    const manifest = await releaseManifest(config.releaseVersion);
    await assertTerraformVersion(manifest);
    const root = await deploymentRoot(manifest);
    await bootstrapForResume(config);
    if (!config.dataOutputs) {
      config.dataOutputs = await applyData(root, config);
      config.phase = "data_ready";
      await saveConfig(config);
    }
    if (!config.computeOutputs) {
      config.computeOutputs = await applyCompute(root, config);
      config.phase = "compute_ready";
      await saveConfig(config);
    }
    if (!config.parametersReady) {
      await storeRuntimeParameters(config);
    }
    if (await pauseForManualDns(config)) return;
    await deploy(config, manifest);
    config.phase = "deployed";
    await saveConfig(config);
    p.outro(`context-use is ready. Create the owner passkey:\n${await ownerSetupUrl(config)}`);
  },
});

async function bootstrapForResume(config: Awaited<ReturnType<typeof readConfig>>): Promise<void> {
  await bootstrapStateBucket(config.awsProfile, config.awsRegion, config.stateBucket);
  if (!config.stateKmsKeyArn) {
    const key = await createStateKmsKey(config.awsProfile, config.awsRegion, config.installationId);
    config.stateKmsKeyArn = key.arn;
    config.stateKmsKeyId = key.id;
    await saveConfig(config);
  }
  await configureStateBucketKms(config.awsProfile, config.awsRegion, config.stateBucket, config.stateKmsKeyArn);
}
