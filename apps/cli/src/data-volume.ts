import { awsArgs, awsJson } from "./aws.ts";
import { run } from "./process.ts";
import type { DeploymentConfig } from "./types.ts";

export const DATA_VOLUME_INITIALIZATION_TAG = "ContextUseInitialization";
const pendingInitialization = "pending";
const completedInitialization = "complete";

type VolumeDescription = {
  VolumeId?: string;
  AvailabilityZone?: string;
  Encrypted?: boolean;
  KmsKeyId?: string;
  SnapshotId?: string;
  Tags?: Array<{ Key: string; Value: string }>;
};

type DescribeVolume = (config: DeploymentConfig) => Promise<VolumeDescription>;

async function describeDataVolume(config: DeploymentConfig): Promise<VolumeDescription> {
  if (!config.dataOutputs) throw new Error("Data infrastructure outputs are missing");
  const result = await awsJson<{ Volumes?: VolumeDescription[] }>(config.awsProfile, config.awsRegion, [
    "ec2", "describe-volumes", "--volume-ids", config.dataOutputs.data_volume_id,
  ]);
  const volume = result.Volumes?.[0];
  if (!volume) throw new Error("Retained data volume was not found");
  return volume;
}

function tagValue(volume: VolumeDescription, key: string): string | undefined {
  return volume.Tags?.find(({ Key }) => Key === key)?.Value;
}

function initializationState(volume: VolumeDescription): string | undefined {
  return tagValue(volume, DATA_VOLUME_INITIALIZATION_TAG);
}

function assertExpectedDataVolume(config: DeploymentConfig, volume: VolumeDescription): void {
  if (!config.dataOutputs) throw new Error("Data infrastructure outputs are missing");
  if (
    volume.VolumeId !== config.dataOutputs.data_volume_id
    || volume.AvailabilityZone !== config.availabilityZone
    || volume.Encrypted !== true
    || volume.KmsKeyId !== config.dataOutputs.kms_key_arn
    || Boolean(volume.SnapshotId)
    || tagValue(volume, "Project") !== "context-use"
    || tagValue(volume, "Environment") !== config.environment
    || tagValue(volume, "Installation") !== config.installationId
    || tagValue(volume, "ManagedBy") !== "context-use-cli"
  ) {
    throw new Error("Refusing to initialize a retained data volume whose AWS identity or provenance is unexpected");
  }
}

export async function dataVolumeInitializationAuthorized(
  config: DeploymentConfig,
  describe: DescribeVolume = describeDataVolume,
): Promise<boolean> {
  if (config.phase !== "data_ready" || config.parametersReady || config.computeOutputs || !config.dataOutputs) return false;
  const volume = await describe(config);
  assertExpectedDataVolume(config, volume);
  return initializationState(volume) === pendingInitialization;
}

export async function markDataVolumeInitialized(
  config: DeploymentConfig,
  describe: DescribeVolume = describeDataVolume,
  execute: typeof run = run,
): Promise<void> {
  if (!config.dataOutputs) throw new Error("Data infrastructure outputs are missing");
  const volume = await describe(config);
  const state = initializationState(volume);
  if (state === completedInitialization || state === undefined) return;
  if (state !== pendingInitialization) throw new Error(`Unexpected retained data volume initialization state: ${state}`);
  assertExpectedDataVolume(config, volume);
  await execute(awsArgs(config.awsProfile, config.awsRegion, [
    "ec2", "create-tags",
    "--resources", config.dataOutputs.data_volume_id,
    "--tags", `Key=${DATA_VOLUME_INITIALIZATION_TAG},Value=${completedInitialization}`,
  ]), { quiet: true });
}
