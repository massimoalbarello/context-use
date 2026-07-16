import { homedir } from "node:os";
import { resolve } from "node:path";
import type { DeploymentConfig } from "./types.ts";

export const configDirectory = resolve(homedir(), ".config/context-use");
export const cacheDirectory = resolve(homedir(), ".cache/context-use");
export const configPath = resolve(configDirectory, "config.json");

export async function readConfig(): Promise<DeploymentConfig> {
  const file = Bun.file(configPath);
  if (!(await file.exists())) throw new Error("No context-use deployment found. Run `context-use setup` first.");
  return file.json() as Promise<DeploymentConfig>;
}

export async function saveConfig(config: DeploymentConfig): Promise<void> {
  await Bun.write(configPath, `${JSON.stringify(config, null, 2)}\n`, { createPath: true, mode: 0o600 });
}
