import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

import type { AgentSyncConnectionMetadata } from "../nango-integrations.ts";

export const AGENT_SYNC_INTEGRATION_ID = "agent-conversations";
export const AGENT_SYNC_FUNCTION_NAME = "conversations";
export const LEGACY_AGENT_SYNC_CONNECTION_ID = "agent-sync";

const AGENT_SYNC_INSTANCE_PATTERN = /^[a-f0-9]{32}$/;
const AGENT_SYNC_CONNECTION_PATTERN = /^agent-sync-([a-f0-9]{32})$/;

const metadataSchema = z.object({
  authenticated_webhook: z.object({
    state: z.enum(["active", "revoked"]),
    token_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict(),
  deployment_id: z.string().min(1),
  instance_id: z.string().regex(AGENT_SYNC_INSTANCE_PATTERN).optional(),
  label: z.string().min(1),
  daemon_version: z.string().min(1),
  updated_at: z.iso.datetime({ offset: true }),
}).strict();

export function newAgentSyncToken(): string {
  return randomBytes(32).toString("base64url");
}

export function newAgentSyncInstanceId(): string {
  return randomBytes(16).toString("hex");
}

export function agentSyncConnectionId(instanceId: string): string {
  if (!AGENT_SYNC_INSTANCE_PATTERN.test(instanceId)) throw new Error("Invalid agent-sync instance ID");
  return `agent-sync-${instanceId}`;
}

export function isAgentSyncConnectionId(value: unknown): value is string {
  return value === LEGACY_AGENT_SYNC_CONNECTION_ID
    || (typeof value === "string" && AGENT_SYNC_CONNECTION_PATTERN.test(value));
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
  instanceId?: string | undefined;
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
  if (input.instanceId && input.metadata.instance_id !== input.instanceId) {
    throw new Error("The Nango agent-sync connection belongs to a different local instance");
  }
  if (
    input.metadata.authenticated_webhook.state === "active"
    && (
      !input.localToken
      || input.metadata.authenticated_webhook.token_sha256 !== agentSyncTokenVerifier(input.localToken)
    )
  ) {
    throw new Error(
      "This agent-sync instance is already registered with a different local credential. "
      + "Restore its credential or revoke that instance before reinstalling it.",
    );
  }
}

export function activeAgentSyncMetadata(input: {
  token: string;
  deploymentId: string;
  label: string;
  version: string;
  instanceId?: string | undefined;
  now?: Date;
}): AgentSyncConnectionMetadata {
  return metadataSchema.parse({
    authenticated_webhook: {
      state: "active",
      token_sha256: agentSyncTokenVerifier(input.token),
    },
    deployment_id: input.deploymentId,
    ...(input.instanceId ? { instance_id: input.instanceId } : {}),
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
    authenticated_webhook: {
      ...previous.authenticated_webhook,
      state: "revoked",
    },
    daemon_version: version,
    updated_at: now.toISOString(),
  });
}
