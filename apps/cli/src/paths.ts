import { homedir } from "node:os";
import { resolve } from "node:path";
import { rm } from "node:fs/promises";
import type { DeploymentConfig } from "./types.ts";

export const configDirectory = resolve(homedir(), ".config/context-use");
export const cacheDirectory = resolve(homedir(), ".cache/context-use");
export const configPath = resolve(configDirectory, "config.json");

type StoredDeploymentConfig = Omit<DeploymentConfig, "schemaVersion"> & {
  schemaVersion?: 1 | 2;
  stateKmsKeyArn?: string;
  phase?: string;
  parametersReady?: boolean;
  dataOutputs?: unknown;
  computeOutputs?: unknown;
};

export function normalizeDeploymentConfig(config: StoredDeploymentConfig): DeploymentConfig {
  const legacyStateKmsKeyArn = config.legacyStateKmsKeyArn ?? config.stateKmsKeyArn;
  return {
    schemaVersion: 2,
    releaseVersion: config.releaseVersion,
    environment: config.environment,
    installationId: config.installationId,
    awsProfile: config.awsProfile,
    awsRegion: config.awsRegion,
    availabilityZone: config.availabilityZone,
    accountId: config.accountId,
    hostname: config.hostname,
    assetHostname: config.assetHostname,
    dnsMode: config.dnsMode,
    route53ZoneId: config.route53ZoneId,
    ownerEmail: config.ownerEmail,
    stateBucket: config.stateBucket,
    instanceType: config.instanceType,
    dataVolumeSizeGb: config.dataVolumeSizeGb,
    backupRetentionDays: config.backupRetentionDays,
    ...(legacyStateKmsKeyArn ? { legacyStateKmsKeyArn } : {}),
    ...(config.recovery ? { recovery: config.recovery } : {}),
  };
}

export async function readConfigIfPresent(): Promise<DeploymentConfig | null> {
  const file = Bun.file(configPath);
  if (!(await file.exists())) return null;
  return normalizeDeploymentConfig(await file.json() as StoredDeploymentConfig);
}

export async function readConfig(): Promise<DeploymentConfig> {
  const config = await readConfigIfPresent();
  if (!config) throw new Error("No context-use deployment found. Run `context-use setup` first.");
  return config;
}

export async function saveConfig(config: DeploymentConfig): Promise<void> {
  await Bun.write(configPath, `${JSON.stringify(config, null, 2)}\n`, { createPath: true, mode: 0o600 });
}

export async function deleteConfig(): Promise<void> {
  await rm(configPath, { force: true });
}
