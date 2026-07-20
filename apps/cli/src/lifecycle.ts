import { bootstrapStateBucket } from "./aws.ts";
import { readConfig } from "./paths.ts";
import { deploymentRoot, releaseManifest } from "./release.ts";
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
