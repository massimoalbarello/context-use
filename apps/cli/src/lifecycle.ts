import { bootstrapStateBucket } from "./aws.ts";
import { readConfig } from "./paths.ts";
import { deploymentRoot, releaseManifest } from "./release.ts";
import { cloudTarget, type DeploymentTarget } from "./target.ts";
import { assertTerraformVersion, currentComputeOutputs, currentDataOutputs } from "./terraform.ts";

export async function readInfrastructure(reconcileStateBucket = true) {
  const config = await readConfig();
  const manifest = await releaseManifest(config.releaseVersion);
  await assertTerraformVersion(manifest);
  const root = await deploymentRoot(manifest);
  if (reconcileStateBucket) {
    await bootstrapStateBucket(config.awsProfile, config.awsRegion, config.stateBucket);
  }
  const [data, compute] = await Promise.all([
    currentDataOutputs(root, config),
    currentComputeOutputs(root, config),
  ]);
  return { config, manifest, root, data, compute };
}

/** Resolve the running cloud instance as a deployment target. */
export async function readCloudTarget(): Promise<{
  config: Awaited<ReturnType<typeof readConfig>>;
  target: DeploymentTarget;
}> {
  const { config, compute } = await readInfrastructure();
  if (config.recovery) throw new Error("Volume recovery is in progress; run `context-use cloud recover`");
  if (!compute) throw new Error("No active instance");
  return { config, target: cloudTarget(config, compute.instance_id) };
}
