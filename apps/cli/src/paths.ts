import { homedir } from "node:os";
import { resolve } from "node:path";
import { rm } from "node:fs/promises";
import type { DeploymentConfig } from "./types.ts";

export const configDirectory = resolve(homedir(), ".config/context-use");
export const cacheDirectory = resolve(homedir(), ".cache/context-use");
export const configPath = resolve(configDirectory, "config.json");

type StoredDeploymentConfig = Omit<DeploymentConfig, "schemaVersion" | "nangoHostname"> & {
  schemaVersion?: 1 | 2;
  nangoHostname?: string;
  stateKmsKeyArn?: string;
  phase?: string;
  parametersReady?: boolean;
  dataOutputs?: unknown;
  computeOutputs?: unknown;
};

export function isValidOwnerEmail(input: unknown): input is string {
  if (typeof input !== "string" || input.length > 254 || input !== input.trim()) return false;
  const separator = input.indexOf("@");
  if (separator < 1 || separator !== input.lastIndexOf("@")) return false;
  const local = input.slice(0, separator);
  const domain = input.slice(separator + 1);
  // Preserve ordinary RFC 5322 atom characters while excluding the values
  // that can become comments, extra entries, or quoting syntax in the
  // generated dotenv and OAuth2 Proxy authorized-emails files.
  if (
    local.length > 64
    || !/^(?!\.)(?!.*\.\.)(?!.*\.$)[A-Za-z0-9!$%&'*+/=?^_`{|}~.-]+$/.test(local)
  ) return false;
  const labels = domain.split(".");
  return labels.length > 1 && labels.every((label) => (
    label.length > 0
    && label.length <= 63
    && /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label)
  ));
}

export function normalizeDeploymentConfig(config: StoredDeploymentConfig): DeploymentConfig {
  if (!isValidOwnerEmail(config.ownerEmail)) {
    throw new Error("Deployment config contains an invalid owner email");
  }
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
    nangoHostname: config.nangoHostname ?? `nango.${config.hostname}`,
    dnsMode: config.dnsMode,
    route53ZoneId: config.route53ZoneId,
    ownerEmail: config.ownerEmail,
    stateBucket: config.stateBucket,
    instanceType: config.instanceType === "t3.small" ? "t3.large" : config.instanceType,
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
  if (!config) throw new Error("No context-use deployment found. Run `context-use cloud setup` first.");
  return config;
}

export async function saveConfig(config: DeploymentConfig): Promise<void> {
  await Bun.write(configPath, `${JSON.stringify(config, null, 2)}\n`, { createPath: true, mode: 0o600 });
}

export async function deleteConfig(): Promise<void> {
  await rm(configPath, { force: true });
}
