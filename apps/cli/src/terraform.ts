import { resolve } from "node:path";
import type { DeploymentConfig } from "./types.ts";
import { run } from "./process.ts";
import type { ReleaseManifest } from "./types.ts";

function compareVersions(left: string, right: string): number {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export async function assertTerraformVersion(manifest: ReleaseManifest): Promise<void> {
  const result = JSON.parse(await run(["terraform", "version", "-json"], { quiet: true })) as { terraform_version?: string };
  if (!result.terraform_version || compareVersions(result.terraform_version, manifest.terraform.minimum) < 0 || compareVersions(result.terraform_version, manifest.terraform.maximum_exclusive) >= 0) {
    throw new Error(`Terraform ${manifest.terraform.minimum} through ${manifest.terraform.maximum_exclusive} (exclusive) is required; found ${result.terraform_version ?? "unknown"}`);
  }
}

function backendArgs(config: DeploymentConfig, key: string): string[] {
  const args = [
    `-backend-config=bucket=${config.stateBucket}`,
    `-backend-config=key=${key}`,
    `-backend-config=region=${config.awsRegion}`,
    `-backend-config=profile=${config.awsProfile}`,
    "-backend-config=encrypt=true",
    "-backend-config=use_lockfile=true",
  ];
  if (config.stateKmsKeyArn) args.push(`-backend-config=kms_key_id=${config.stateKmsKeyArn}`);
  return args;
}

async function init(directory: string, config: DeploymentConfig, key: string): Promise<void> {
  await run(["terraform", "init", "-input=false", "-reconfigure", ...backendArgs(config, key)], { cwd: directory, quiet: true });
}

function stateKey(config: DeploymentConfig, component: string): string {
  return `${config.installationId}/${config.environment}/${component}.tfstate`;
}

export async function applyData(root: string, config: DeploymentConfig): Promise<NonNullable<DeploymentConfig["dataOutputs"]>> {
  const directory = resolve(root, "infra/data");
  console.log("Applying retained, encrypted data infrastructure…");
  await init(directory, config, stateKey(config, "data"));
  await run(["terraform", "apply", "-input=false", "-auto-approve",
    `-var=aws_region=${config.awsRegion}`,
    `-var=availability_zone=${config.availabilityZone}`,
    `-var=environment=${config.environment}`,
    `-var=installation_id=${config.installationId}`,
    `-var=app_hostname=${config.hostname}`,
    `-var=data_volume_size_gb=${config.dataVolumeSizeGb}`,
    `-var=backup_retention_days=${config.backupRetentionDays}`,
  ], { cwd: directory });
  return terraformOutputs(directory);
}

export async function applyCompute(root: string, config: DeploymentConfig): Promise<NonNullable<DeploymentConfig["computeOutputs"]>> {
  if (!config.dataOutputs) throw new Error("Data infrastructure outputs are missing");
  const directory = resolve(root, "infra/compute");
  console.log("Applying single-instance compute infrastructure…");
  await init(directory, config, stateKey(config, "compute"));
  await run(["terraform", "apply", "-input=false", "-auto-approve",
    `-var=aws_region=${config.awsRegion}`,
    `-var=availability_zone=${config.availabilityZone}`,
    `-var=environment=${config.environment}`,
    `-var=installation_id=${config.installationId}`,
    `-var=instance_type=${config.instanceType}`,
    `-var=app_hostname=${config.hostname}`,
    `-var=asset_hostname=${config.assetHostname}`,
    `-var=route53_zone_id=${config.route53ZoneId}`,
    `-var=data_volume_id=${config.dataOutputs.data_volume_id}`,
    `-var=kms_key_arn=${config.dataOutputs.kms_key_arn}`,
    `-var=asset_bucket=${config.dataOutputs.asset_bucket}`,
    `-var=backup_bucket=${config.dataOutputs.backup_bucket}`,
    `-var=ssm_parameter_prefix=/context-use/${config.installationId}/${config.environment}`,
  ], { cwd: directory });
  return terraformOutputs(directory);
}

export async function destroyCompute(root: string, config: DeploymentConfig): Promise<void> {
  const directory = resolve(root, "infra/compute");
  await init(directory, config, stateKey(config, "compute"));
  await run(["terraform", "destroy", "-input=false", "-auto-approve",
    `-var=aws_region=${config.awsRegion}`, `-var=availability_zone=${config.availabilityZone}`,
    `-var=environment=${config.environment}`, `-var=installation_id=${config.installationId}`, `-var=instance_type=${config.instanceType}`,
    `-var=app_hostname=${config.hostname}`, `-var=asset_hostname=${config.assetHostname}`,
    `-var=route53_zone_id=${config.route53ZoneId}`, `-var=data_volume_id=${config.dataOutputs?.data_volume_id}`,
    `-var=kms_key_arn=${config.dataOutputs?.kms_key_arn}`, `-var=asset_bucket=${config.dataOutputs?.asset_bucket}`,
    `-var=backup_bucket=${config.dataOutputs?.backup_bucket}`, `-var=ssm_parameter_prefix=/context-use/${config.installationId}/${config.environment}`,
  ], { cwd: directory });
}


export async function destroyData(root: string, config: DeploymentConfig): Promise<void> {
  if (!config.dataOutputs) throw new Error("Data infrastructure outputs are missing");
  const directory = resolve(root, "infra/data");
  await init(directory, config, stateKey(config, "data"));
  await run(["terraform", "destroy", "-input=false", "-auto-approve",
    `-var=aws_region=${config.awsRegion}`, `-var=availability_zone=${config.availabilityZone}`,
    `-var=environment=${config.environment}`, `-var=installation_id=${config.installationId}`,
    `-var=app_hostname=${config.hostname}`, `-var=data_volume_size_gb=${config.dataVolumeSizeGb}`,
    `-var=backup_retention_days=${config.backupRetentionDays}`,
  ], { cwd: directory });
}

async function terraformOutputs<T>(directory: string): Promise<T> {
  const raw = JSON.parse(await run(["terraform", "output", "-json"], { cwd: directory, quiet: true })) as Record<string, { value: unknown }>;
  return Object.fromEntries(Object.entries(raw).map(([key, output]) => [key, output.value])) as T;
}
