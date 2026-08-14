import { readFile, rm } from "node:fs/promises";
import { z } from "zod";

import { atomicSecureWrite } from "./files.ts";
import {
  agentSyncConfigPath,
  agentSyncCredentialPath,
  agentSyncDirectory,
} from "./paths.ts";
import type { AgentSyncConfig } from "./types.ts";

const configBaseSchema = z.object({
  deploymentId: z.string().min(1),
  connectionId: z.string().min(1),
  webhookUrl: z.url(),
  installedAt: z.iso.datetime({ offset: true }),
  label: z.string().min(1),
});

const legacyConfigSchema = configBaseSchema.extend({
  schemaVersion: z.literal(1),
  connectionId: z.literal("agent-sync"),
}).strict();

const instanceConfigSchema = configBaseSchema.extend({
  schemaVersion: z.literal(2),
  instanceId: z.string().regex(/^[a-f0-9]{32}$/),
}).strict().refine(
  (config) => config.connectionId === `agent-sync-${config.instanceId}`,
  { message: "Agent-sync connection ID does not match its instance ID", path: ["connectionId"] },
);

const configSchema = z.union([legacyConfigSchema, instanceConfigSchema]);

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
