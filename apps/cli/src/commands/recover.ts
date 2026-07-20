import * as p from "@clack/prompts";
import { defineCommand } from "@parshjs/core";
import { retainedDataVolumeExists } from "../data-volume.ts";
import { deploy, prepareCompute } from "../deploy.ts";
import { readInfrastructure } from "../lifecycle.ts";
import { saveConfig } from "../paths.ts";
import { ensureRuntimeParameters, pauseForManualDns } from "../setup.ts";
import { applyCompute, applyData, currentComputeOutputs, destroyCompute } from "../terraform.ts";
import { selectBackup } from "./restore.ts";

export const command = defineCommand("recover", {
  description: "Replace a lost retained volume and restore its database.",
  options: {},
  handler: async () => {
    const { config, manifest, root, data, compute } = await readInfrastructure();
    if (!data) throw new Error("Retained data state is missing; refusing to guess which resources to replace");

    if (!config.recovery) {
      if (await retainedDataVolumeExists(config, data)) {
        throw new Error("The retained volume still exists; use `context-use restore` for database recovery");
      }
      const backupKey = await selectBackup(config, data);
      const typed = await p.text({ message: `Type ${config.hostname} to replace the lost volume and restore ${backupKey}` });
      if (p.isCancel(typed) || typed !== config.hostname) throw new Error("Confirmation did not match");
      config.recovery = { backupKey, previousVolumeId: data.data_volume_id };
      await saveConfig(config);
    }

    const recovery = config.recovery;
    let nextCompute = compute;
    if (data.data_volume_id === recovery.previousVolumeId && nextCompute) {
      await destroyCompute(root, config, data);
      nextCompute = null;
    }
    const recoveredData = await applyData(root, config);
    if (recoveredData.data_volume_id === recovery.previousVolumeId) {
      throw new Error("Terraform did not replace the lost retained volume");
    }
    nextCompute ??= await currentComputeOutputs(root, config);
    nextCompute ??= await applyCompute(root, config, recoveredData, true);
    await prepareCompute(config, recoveredData, nextCompute);
    await ensureRuntimeParameters(config, recoveredData, nextCompute);
    if (await pauseForManualDns(config, nextCompute, "recover")) return;
    await deploy(config, nextCompute, manifest, recovery.backupKey);
    delete config.recovery;
    await saveConfig(config);
    p.outro(`Recovered the database from ${recovery.backupKey}. Versioned assets remained in ${recoveredData.asset_bucket}.`);
  },
});
