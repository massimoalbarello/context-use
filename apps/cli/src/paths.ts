import { homedir } from "node:os";
import { resolve } from "node:path";
import type { DeploymentConfig } from "./types.ts";

export const configDirectory = resolve(homedir(), ".config/context-use");
export const cacheDirectory = resolve(homedir(), ".cache/context-use");
export const configPath = resolve(configDirectory, "config.json");

type StoredDeploymentConfig = Omit<DeploymentConfig, "publicMcpHostname"> & {
  publicMcpHostname?: string;
};

export function defaultPublicMcpHostname(hostname: string): string {
  return `public.${hostname}`;
}

export function normalizeDeploymentConfig(config: StoredDeploymentConfig): DeploymentConfig {
  return {
    ...config,
    publicMcpHostname: config.publicMcpHostname ?? defaultPublicMcpHostname(config.hostname),
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
