import * as p from "@clack/prompts";
import { defineCommand } from "@parshjs/core";
import { z } from "zod";
import {
  bucketExists,
  deleteParameterPath,
  deleteStateBucket,
  emptyVersionedBucket,
  scheduleStateKmsKeyDeletion,
} from "../aws.ts";
import { readInfrastructure } from "../lifecycle.ts";
import { configPath, deleteConfig } from "../paths.ts";
import { destroyCompute, destroyData } from "../terraform.ts";

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
    const { config, root, data, compute } = await readInfrastructure();
    const typed = await p.text({
      message: purgeData
        ? `Type ${config.hostname} to permanently destroy all data`
        : `Type ${config.hostname} to destroy compute while preserving data`,
    });
    if (p.isCancel(typed) || typed !== config.hostname) throw new Error("Confirmation did not match");
    if (compute) {
      if (!data) throw new Error("Retained data outputs are missing; refusing to destroy dependent compute");
      await destroyCompute(root, config, data);
    }
    if (purgeData) {
      const confirmed = await p.confirm({
        message: "Final confirmation: permanently delete every page, asset, backup, secret, and encryption key?",
        initialValue: false,
      });
      if (p.isCancel(confirmed) || !confirmed) {
        throw new Error("Permanent purge cancelled; compute was removed but data is retained");
      }
      const bucketPrefix = `cu-${config.accountId}-${config.awsRegion}-${config.installationId}`;
      if (!data && (await bucketExists(config.awsProfile, config.awsRegion, `${bucketPrefix}-assets`)
        || await bucketExists(config.awsProfile, config.awsRegion, `${bucketPrefix}-backups`))) {
        throw new Error("Retained resources still exist but their Terraform outputs are missing; refusing an unverifiable purge");
      }
      await emptyVersionedBucket(config.awsProfile, config.awsRegion, data?.asset_bucket ?? `${bucketPrefix}-assets`);
      await emptyVersionedBucket(config.awsProfile, config.awsRegion, data?.backup_bucket ?? `${bucketPrefix}-backups`);
      await deleteParameterPath(config.awsProfile, config.awsRegion, `/context-use/${config.installationId}/${config.environment}`);
      if (data) await destroyData(root, config);
      await deleteStateBucket(config.awsProfile, config.awsRegion, config.stateBucket);
      if (config.legacyStateKmsKeyArn) {
        await scheduleStateKmsKeyDeletion(config.awsProfile, config.awsRegion, config.installationId, config.legacyStateKmsKeyArn);
      }
      await deleteConfig();
      p.outro("All context-use infrastructure and retained data were destroyed. KMS keys are scheduled for deletion after their safety windows.");
      return;
    }
    p.outro(`Compute destroyed. Encrypted data and state remain in AWS. Config: ${configPath}`);
  },
});
