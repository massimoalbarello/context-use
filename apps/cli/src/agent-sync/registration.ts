import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

import type { AgentSyncConnectionMetadata } from "../nango-integrations.ts";

export const AGENT_SYNC_INTEGRATION_ID = "agent-conversations";
export const AGENT_SYNC_FUNCTION_NAME = "conversations";
export const AGENT_SYNC_CONNECTION_ID = "agent-sync";

const metadataSchema = z.object({
  state: z.enum(["active", "revoked"]),
  token_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  deployment_id: z.string().min(1),
  label: z.string().min(1),
  daemon_version: z.string().min(1),
  updated_at: z.iso.datetime({ offset: true }),
}).strict();

export function newAgentSyncToken(): string {
  return randomBytes(32).toString("base64url");
}

export function agentSyncTokenVerifier(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function parseAgentSyncMetadata(value: unknown): AgentSyncConnectionMetadata | null {
  const result = metadataSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function assertAgentSyncActivationAllowed(input: {
  connectionExists: boolean;
  metadata: AgentSyncConnectionMetadata | null;
  localToken: string | null;
  deploymentId: string;
}): void {
  if (!input.connectionExists) return;
  if (!input.metadata) {
    throw new Error(
      "The Nango agent-sync connection has unrecognized metadata; inspect it in the Nango dashboard before replacing it",
    );
  }
  if (input.metadata.deployment_id !== input.deploymentId) {
    throw new Error("The Nango agent-sync connection belongs to a different Context Use deployment");
  }
  if (
    input.metadata.state === "active"
    && (!input.localToken || input.metadata.token_sha256 !== agentSyncTokenVerifier(input.localToken))
  ) {
    throw new Error(
      "Agent sync is already registered on another computer. This release supports one installation; "
      + "uninstall that installation before installing this one.",
    );
  }
}

export function activeAgentSyncMetadata(input: {
  token: string;
  deploymentId: string;
  label: string;
  version: string;
  now?: Date;
}): AgentSyncConnectionMetadata {
  return metadataSchema.parse({
    state: "active",
    token_sha256: agentSyncTokenVerifier(input.token),
    deployment_id: input.deploymentId,
    label: input.label,
    daemon_version: input.version,
    updated_at: (input.now ?? new Date()).toISOString(),
  });
}

export function revokedAgentSyncMetadata(
  previous: AgentSyncConnectionMetadata,
  version: string,
  now = new Date(),
): AgentSyncConnectionMetadata {
  return metadataSchema.parse({
    ...previous,
    state: "revoked",
    daemon_version: version,
    updated_at: now.toISOString(),
  });
}
