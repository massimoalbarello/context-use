import * as p from "@clack/prompts";
import { defineCommand } from "@parshjs/core";

import { retainedDataVolumeExists } from "../data-volume.ts";
import { deploy, prepareCompute } from "../deploy.ts";
import { assertInstanceTypeSupported, instanceTypeSchema } from "../instance-type.ts";
import { readInfrastructure } from "../lifecycle.ts";
import { saveConfig } from "../paths.ts";
import { applyCompute } from "../terraform.ts";

export const command = defineCommand("resize", {
  description: "Change the EC2 instance type while retaining deployment data.",
  options: {
    "instance-type": {
      schema: instanceTypeSchema,
      description: "Target x86-64 EC2 type with at least 2 vCPU and 4 GiB RAM (for example, t3a.medium).",
    },
  },
  handler: async ({ options }) => {
    const instanceType = options["instance-type"];
    const { config, manifest, root, data, compute } = await readInfrastructure();
    if (config.recovery) throw new Error("Volume recovery is in progress; run `context-use recover`");
    if (!data || !compute) throw new Error("No active deployment");
    if (!await retainedDataVolumeExists(config, data)) {
      throw new Error("The retained data volume is missing; run `context-use recover`");
    }
    await assertInstanceTypeSupported(config, instanceType);

    const previousInstanceType = config.instanceType;
    const resizedConfig = { ...config, instanceType };
    // Persist the desired configuration before applying it so a failed or
    // interrupted resize can be converged by rerunning this command.
    await saveConfig(resizedConfig);
    p.log.info(previousInstanceType === instanceType
      ? `Reconciling ${instanceType}; the application may be briefly unavailable`
      : `Resizing ${previousInstanceType} to ${instanceType}; the application will be briefly unavailable`);
    const resizedCompute = await applyCompute(root, resizedConfig, data);
    await prepareCompute(resizedConfig, data, resizedCompute);
    // A newer AMI can make Terraform replace the disposable root instance
    // during the same apply. Reinstall the pinned runtime in either case; all
    // durable databases, assets, and secrets remain on retained infrastructure.
    await deploy(resizedConfig, resizedCompute, manifest);
    p.outro(`Instance type is ${instanceType}; retained data volume ${data.data_volume_id} is attached`);
  },
});
