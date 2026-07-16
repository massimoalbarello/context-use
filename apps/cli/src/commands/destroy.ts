import * as p from "@clack/prompts";
import { defineCommand } from "@parshjs/core";
import { z } from "zod";
import {
  deleteParameterPath,
  deleteStateBucket,
  emptyVersionedBucket,
  scheduleStateKmsKeyDeletion,
} from "../aws.ts";
import { configPath, readConfig, saveConfig } from "../paths.ts";
import { deploymentRoot, releaseManifest } from "../release.ts";
import { assertTerraformVersion, destroyCompute, destroyData } from "../terraform.ts";

export const command = defineCommand("destroy", {
  description: "Remove compute while preserving data by default.",
  options: {
    "purge-data": {
      schema: z.boolean().optional(),
      description: "Also permanently destroy retained data.",
    },
  },
  handler: async ({ options }) => {
    const purgeData = options["purge-data"];
    const config = await readConfig();
    if (config.phase === "purged") throw new Error("This installation has already been permanently purged");
    const typed = await p.text({
      message: purgeData
        ? `Type ${config.hostname} to permanently destroy all data`
        : `Type ${config.hostname} to destroy compute while preserving data`,
    });
    if (p.isCancel(typed) || typed !== config.hostname) throw new Error("Confirmation did not match");
    const manifest = await releaseManifest(config.releaseVersion);
    await assertTerraformVersion(manifest);
    const root = await deploymentRoot(manifest);
    if (config.computeOutputs) await destroyCompute(root, config);
    delete config.computeOutputs;
    config.phase = "destroyed";
    await saveConfig(config);
    if (purgeData) {
      const confirmed = await p.confirm({
        message: "Final confirmation: permanently delete every page, asset, backup, secret, and encryption key?",
        initialValue: false,
      });
      if (p.isCancel(confirmed) || !confirmed) {
        throw new Error("Permanent purge cancelled; compute was removed but data is retained");
      }
      if (!config.dataOutputs) throw new Error("Data outputs are missing; refusing an unverifiable purge");
      await emptyVersionedBucket(config.awsProfile, config.awsRegion, config.dataOutputs.asset_bucket);
      await emptyVersionedBucket(config.awsProfile, config.awsRegion, config.dataOutputs.backup_bucket);
      await deleteParameterPath(config.awsProfile, config.awsRegion, `/context-use/${config.installationId}/${config.environment}`);
      await destroyData(root, config);
      await deleteStateBucket(config.awsProfile, config.awsRegion, config.stateBucket);
      if (config.stateKmsKeyArn) {
        await scheduleStateKmsKeyDeletion(config.awsProfile, config.awsRegion, config.installationId, config.stateKmsKeyArn);
      }
      delete config.dataOutputs;
      config.phase = "purged";
      await saveConfig(config);
      p.outro("All context-use infrastructure and retained data were destroyed. The KMS key is scheduled for deletion after its safety window.");
      return;
    }
    p.outro(`Compute destroyed. Encrypted data and state remain in AWS. Config: ${configPath}`);
  },
});
