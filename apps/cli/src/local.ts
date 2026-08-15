import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { generateSecret } from "./aws.ts";
import { configDirectory, isValidOwnerEmail } from "./paths.ts";
import { deploymentRoot, releaseManifest } from "./release.ts";
import { readReleaseImages } from "./release-images.ts";
import {
  generateNangoEncryptionKey,
  LOCAL_RUNTIME_SECRETS,
  RUNTIME_SECRET_LENGTHS,
} from "./runtime-secrets.ts";
import { composeInvocation, deploymentPreamble, type DeploymentTarget, localTarget } from "./target.ts";
import type { ReleaseManifest } from "./types.ts";

export const localConfigPath = resolve(configDirectory, "local.json");
export const localRuntimeEnvPath = resolve(configDirectory, "local/runtime.env");

/**
 * A local installation is kept beside the cloud one rather than inside it. The
 * two coexist by design: the intended path to a deployed instance is to run
 * locally first, then export the knowledge archive and restore it into a fresh
 * cloud installation.
 */
export type LocalConfig = {
  schemaVersion: 1;
  releaseVersion: string;
  ownerEmail: string;
  appPort: number;
  nangoPort: number;
};

export const DEFAULT_APP_PORT = 5173;
export const DEFAULT_NANGO_PORT = 5174;

function validPort(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1024 && value <= 65535;
}

export function normalizeLocalConfig(config: unknown): LocalConfig {
  const raw = config as Partial<LocalConfig>;
  if (!isValidOwnerEmail(raw?.ownerEmail)) throw new Error("Local config contains an invalid owner email");
  if (typeof raw.releaseVersion !== "string" || !/^v\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/.test(raw.releaseVersion)) {
    throw new Error("Local config contains an invalid release version");
  }
  if (!validPort(raw.appPort) || !validPort(raw.nangoPort)) {
    throw new Error("Local config contains an invalid port");
  }
  if (raw.appPort === raw.nangoPort) throw new Error("Local config reuses one port for two services");
  return {
    schemaVersion: 1,
    releaseVersion: raw.releaseVersion,
    ownerEmail: raw.ownerEmail,
    appPort: raw.appPort,
    nangoPort: raw.nangoPort,
  };
}

export async function readLocalConfigIfPresent(): Promise<LocalConfig | null> {
  const file = Bun.file(localConfigPath);
  if (!(await file.exists())) return null;
  return normalizeLocalConfig(await file.json());
}

export async function readLocalConfig(): Promise<LocalConfig> {
  const config = await readLocalConfigIfPresent();
  if (!config) throw new Error("No local context-use installation found. Run `context-use local setup` first.");
  return config;
}

export async function saveLocalConfig(config: LocalConfig): Promise<void> {
  await Bun.write(localConfigPath, `${JSON.stringify(config, null, 2)}\n`, { createPath: true, mode: 0o600 });
}

export async function deleteLocalConfig(): Promise<void> {
  await rm(localConfigPath, { force: true });
}

export function localAppOrigin(config: LocalConfig): string {
  return `http://localhost:${config.appPort}`;
}

export function localNangoOrigin(config: LocalConfig): string {
  return `http://localhost:${config.nangoPort}`;
}

/**
 * The deployment bundle the CLI already downloads and verifies for a cloud
 * release also carries the local Compose file, so a local installation needs no
 * separate distribution channel and stays pinned to the same release.
 */
export async function localDeployDirectory(manifest: ReleaseManifest): Promise<string> {
  return resolve(await deploymentRoot(manifest), "deploy");
}

export async function readLocalTarget(): Promise<{ config: LocalConfig; target: DeploymentTarget }> {
  const config = await readLocalConfig();
  const manifest = await releaseManifest(config.releaseVersion);
  return {
    config,
    target: localTarget({
      origin: localAppOrigin(config),
      deployDirectory: await localDeployDirectory(manifest),
      runtimeEnvPath: localRuntimeEnvPath,
    }),
  };
}

/**
 * Compose needs `--file` here because the local file sits beside the cloud
 * `docker-compose.yml` in the same released deployment directory.
 */
export function localCompose(target: DeploymentTarget): string {
  return `${composeInvocation(target)} --file compose.local.yml`;
}

export function localComposeCommands(target: DeploymentTarget, ...arguments_: string[]): string[] {
  return [...deploymentPreamble(target), `${localCompose(target)} ${arguments_.join(" ")}`];
}

export type LocalRuntimeEnvironment = {
  values: Record<string, string>;
  ownerSetupToken: string;
};

export async function buildLocalRuntimeEnvironment(
  config: LocalConfig,
  manifest: ReleaseManifest,
): Promise<LocalRuntimeEnvironment> {
  const images = await readReleaseImages(await deploymentRoot(manifest));
  const ownerSetupToken = generateSecret(32);
  const values: Record<string, string> = {
    APP_IMAGE: manifest.images.app,
    BACKUP_IMAGE: manifest.images.backup,
    NANGO_IMAGE: images.nango,
    APP_ORIGIN: localAppOrigin(config),
    NANGO_ORIGIN: localNangoOrigin(config),
    APP_PORT: String(config.appPort),
    NANGO_PORT: String(config.nangoPort),
    OWNER_EMAIL: config.ownerEmail,
    NANGO_DASHBOARD_USERNAME: config.ownerEmail,
    OWNER_SETUP_TOKEN_HASH: createHash("sha256").update(ownerSetupToken).digest("hex"),
  };
  for (const name of LOCAL_RUNTIME_SECRETS) {
    values[name] = name === "NANGO_ENCRYPTION_KEY"
      ? generateNangoEncryptionKey()
      : generateSecret(RUNTIME_SECRET_LENGTHS[name]);
  }
  return { values, ownerSetupToken };
}

export function serializeRuntimeEnvironment(values: Record<string, string>): string {
  for (const [name, value] of Object.entries(values)) {
    if (value.includes("\n") || value.includes("\r")) throw new Error(`Runtime value ${name} spans multiple lines`);
  }
  return `${Object.entries(values).map(([name, value]) => `${name}=${value}`).join("\n")}\n`;
}

export async function writeLocalRuntimeEnvironment(values: Record<string, string>): Promise<void> {
  await Bun.write(localRuntimeEnvPath, serializeRuntimeEnvironment(values), { createPath: true, mode: 0o600 });
}

export async function readLocalRuntimeEnvironment(): Promise<Record<string, string>> {
  const file = Bun.file(localRuntimeEnvPath);
  if (!(await file.exists())) throw new Error(`Local runtime environment is missing at ${localRuntimeEnvPath}`);
  const values: Record<string, string> = {};
  for (const line of (await file.text()).split("\n")) {
    const separator = line.indexOf("=");
    if (separator > 0) values[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return values;
}

/**
 * Replace one value in place, then recreate the services that read it. Used for
 * the Nango pipeline key, which only exists after Nango itself is running.
 */
export async function updateLocalRuntimeValue(name: string, value: string): Promise<void> {
  const values = await readLocalRuntimeEnvironment();
  values[name] = value;
  await writeLocalRuntimeEnvironment(values);
}

export function localSetupUrl(config: LocalConfig, ownerSetupToken: string): string {
  return `${localAppOrigin(config)}/app#setup=${encodeURIComponent(ownerSetupToken)}`;
}

export async function removeLocalRuntimeEnvironment(): Promise<void> {
  await rm(localRuntimeEnvPath, { force: true });
}
