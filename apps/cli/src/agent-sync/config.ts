import { readFile, rm } from "node:fs/promises";
import { z } from "zod";

import { atomicSecureWrite } from "./files.ts";
import {
  agentSyncConfigPath,
  agentSyncCredentialPath,
  agentSyncDirectory,
} from "./paths.ts";
import type { AgentSyncConfig } from "./types.ts";

const configSchema = z.object({
  schemaVersion: z.literal(1),
  deploymentId: z.string().min(1),
  connectionId: z.string().min(1),
  webhookUrl: z.url(),
  installedAt: z.iso.datetime({ offset: true }),
  label: z.string().min(1),
}).strict();

export async function readAgentSyncConfig(): Promise<AgentSyncConfig | null> {
  try {
    return configSchema.parse(JSON.parse(await readFile(agentSyncConfigPath, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function writeAgentSyncConfig(config: AgentSyncConfig): Promise<void> {
  await atomicSecureWrite(agentSyncConfigPath, `${JSON.stringify(configSchema.parse(config), null, 2)}\n`);
}

export async function readAgentSyncToken(): Promise<string | null> {
  try {
    const token = (await readFile(agentSyncCredentialPath, "utf8")).trim();
    return token || null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function writeAgentSyncToken(token: string): Promise<void> {
  if (!/^[A-Za-z0-9_-]{43,}$/.test(token)) throw new Error("Invalid agent-sync credential");
  await atomicSecureWrite(agentSyncCredentialPath, `${token}\n`);
}

export async function removeAgentSyncFiles(): Promise<void> {
  await rm(agentSyncDirectory, { recursive: true, force: true });
}
