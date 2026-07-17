import { resolve } from "node:path";
import { awsArgs } from "./aws.ts";
import type { DeploymentConfig } from "./types.ts";
import { run, type RunOptions } from "./process.ts";
import type { ReleaseManifest } from "./types.ts";

type CommandRunner = (command: string[], options?: RunOptions) => Promise<string>;

type ProcessCredentials = {
  AccessKeyId?: string;
  SecretAccessKey?: string;
  SessionToken?: string;
};

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

export function backendArgs(config: DeploymentConfig, key: string): string[] {
  return [
    `-backend-config=bucket=${config.stateBucket}`,
    `-backend-config=key=${key}`,
    `-backend-config=region=${config.awsRegion}`,
    "-backend-config=encrypt=true",
    "-backend-config=use_lockfile=true",
    ...(config.stateKmsKeyArn ? [`-backend-config=kms_key_id=${config.stateKmsKeyArn}`] : []),
  ];
}

export async function terraformEnvironment(config: DeploymentConfig, execute: CommandRunner = run): Promise<Record<string, string>> {
  const raw = await execute(awsArgs(config.awsProfile, config.awsRegion, ["configure", "export-credentials", "--format", "process"]), { quiet: true });
  const credentials = JSON.parse(raw) as ProcessCredentials;
  if (!credentials.AccessKeyId || !credentials.SecretAccessKey) {
    throw new Error(`AWS profile ${config.awsProfile} did not export usable credentials`);
  }
  return {
    AWS_ACCESS_KEY_ID: credentials.AccessKeyId,
    AWS_SECRET_ACCESS_KEY: credentials.SecretAccessKey,
    AWS_SESSION_TOKEN: credentials.SessionToken ?? "",
    AWS_REGION: config.awsRegion,
    AWS_DEFAULT_REGION: config.awsRegion,
    AWS_EC2_METADATA_DISABLED: "true",
  };
}

async function init(directory: string, config: DeploymentConfig, key: string, env: Record<string, string>): Promise<void> {
  await run(["terraform", "init", "-input=false", "-reconfigure", ...backendArgs(config, key)], { cwd: directory, env, quiet: true });
}

function stateKey(config: DeploymentConfig, component: string): string {
  return `${config.installationId}/${config.environment}/${component}.tfstate`;
}

export async function applyData(root: string, config: DeploymentConfig): Promise<NonNullable<DeploymentConfig["dataOutputs"]>> {
  const directory = resolve(root, "infra/data");
  const env = await terraformEnvironment(config);
  console.log("Applying retained, encrypted data infrastructure…");
  await init(directory, config, stateKey(config, "data"), env);
  await run(["terraform", "apply", "-input=false", "-auto-approve",
    `-var=aws_region=${config.awsRegion}`,
    `-var=availability_zone=${config.availabilityZone}`,
    `-var=environment=${config.environment}`,
    `-var=installation_id=${config.installationId}`,
    `-var=data_volume_size_gb=${config.dataVolumeSizeGb}`,
    `-var=backup_retention_days=${config.backupRetentionDays}`,
  ], { cwd: directory, env });
  return terraformOutputs(directory, env);
}

export async function applyCompute(root: string, config: DeploymentConfig): Promise<NonNullable<DeploymentConfig["computeOutputs"]>> {
  if (!config.dataOutputs) throw new Error("Data infrastructure outputs are missing");
  const directory = resolve(root, "infra/compute");
  const env = await terraformEnvironment(config);
  console.log("Applying single-instance compute infrastructure…");
  await init(directory, config, stateKey(config, "compute"), env);
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
  ], { cwd: directory, env });
  return terraformOutputs(directory, env);
}

export async function currentComputeOutputs(root: string, config: DeploymentConfig): Promise<NonNullable<DeploymentConfig["computeOutputs"]>> {
  const directory = resolve(root, "infra/compute");
  const env = await terraformEnvironment(config);
  await init(directory, config, stateKey(config, "compute"), env);
  const outputs = await terraformOutputs<NonNullable<DeploymentConfig["computeOutputs"]>>(directory, env);
  if (!outputs.instance_id) throw new Error("Terraform state has no active compute deployment");
  return outputs;
}

export async function destroyCompute(root: string, config: DeploymentConfig): Promise<void> {
  const directory = resolve(root, "infra/compute");
  const env = await terraformEnvironment(config);
  await init(directory, config, stateKey(config, "compute"), env);
  await run(["terraform", "destroy", "-input=false", "-auto-approve",
    `-var=aws_region=${config.awsRegion}`, `-var=availability_zone=${config.availabilityZone}`,
    `-var=environment=${config.environment}`, `-var=installation_id=${config.installationId}`, `-var=instance_type=${config.instanceType}`,
    `-var=app_hostname=${config.hostname}`, `-var=asset_hostname=${config.assetHostname}`,
    `-var=route53_zone_id=${config.route53ZoneId}`, `-var=data_volume_id=${config.dataOutputs?.data_volume_id}`,
    `-var=kms_key_arn=${config.dataOutputs?.kms_key_arn}`, `-var=asset_bucket=${config.dataOutputs?.asset_bucket}`,
    `-var=backup_bucket=${config.dataOutputs?.backup_bucket}`, `-var=ssm_parameter_prefix=/context-use/${config.installationId}/${config.environment}`,
  ], { cwd: directory, env });
}


export async function destroyData(root: string, config: DeploymentConfig): Promise<void> {
  if (!config.dataOutputs) throw new Error("Data infrastructure outputs are missing");
  const directory = resolve(root, "infra/data");
  const env = await terraformEnvironment(config);
  await init(directory, config, stateKey(config, "data"), env);
  await run(["terraform", "destroy", "-input=false", "-auto-approve",
    `-var=aws_region=${config.awsRegion}`, `-var=availability_zone=${config.availabilityZone}`,
    `-var=environment=${config.environment}`, `-var=installation_id=${config.installationId}`,
    `-var=data_volume_size_gb=${config.dataVolumeSizeGb}`,
    `-var=backup_retention_days=${config.backupRetentionDays}`,
  ], { cwd: directory, env });
}

async function terraformOutputs<T>(directory: string, env: Record<string, string>): Promise<T> {
  const raw = JSON.parse(await run(["terraform", "output", "-json"], { cwd: directory, env, quiet: true })) as Record<string, { value: unknown }>;
  return Object.fromEntries(Object.entries(raw).map(([key, output]) => [key, output.value])) as T;
}
