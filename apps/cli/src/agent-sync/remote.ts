import { z } from "zod";

import type { AgentConversationRecord } from "./record.ts";

const acceptedSchema = z.object({ accepted: z.boolean() }).passthrough();
const statusSchema = z.object({ active: z.literal(true) }).passthrough();
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

export type AgentSyncWebhookPayload = {
  type: "agent.conversation.upsert";
  connectionId: string;
  batchId: string;
  sentAt: string;
  records: AgentConversationRecord[];
};

export type AgentSyncRemoteDependencies = {
  fetcher?: typeof fetch;
  pause?: (milliseconds: number) => Promise<void>;
  random?: () => number;
};

export async function pushAgentConversations(
  webhookUrl: string,
  token: string,
  payload: AgentSyncWebhookPayload,
  dependencies: AgentSyncRemoteDependencies = {},
): Promise<void> {
  const response = await authenticatedRequest(webhookUrl, token, payload, true, dependencies);
  const result = acceptedSchema.parse(await response.json());
  if (!result.accepted) throw new Error("Nango did not accept the agent-sync batch");
}

export async function probeAgentSync(
  webhookUrl: string,
  token: string,
  connectionId: string,
  dependencies: AgentSyncRemoteDependencies = {},
): Promise<boolean> {
  const response = await authenticatedRequest(
    webhookUrl,
    token,
    { type: "nango.authenticated-webhook.status", connectionId },
    false,
    dependencies,
  );
  return statusSchema.parse(await response.json()).active;
}

async function authenticatedRequest(
  webhookUrl: string,
  token: string,
  body: unknown,
  retry: boolean,
  dependencies: AgentSyncRemoteDependencies,
): Promise<Response> {
  const fetcher = dependencies.fetcher ?? fetch;
  const pause = dependencies.pause ?? ((milliseconds: number) => Bun.sleep(milliseconds));
  const random = dependencies.random ?? Math.random;
  const attempts = retry ? 3 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let response: Response;
    try {
      response = await fetcher(webhookUrl, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      if (attempt + 1 === attempts) throw new Error("Agent-sync request could not reach Nango");
      await pause(backoff(attempt, random));
      continue;
    }
    if (response.ok) return response;
    if (RETRYABLE_STATUS.has(response.status) && attempt + 1 < attempts) {
      await pause(backoff(attempt, random));
      continue;
    }
    throw new Error(`Agent-sync request was rejected with HTTP ${response.status}`);
  }
  throw new Error("Agent-sync request exhausted its retries");
}

function backoff(attempt: number, random: () => number): number {
  return (500 * (2 ** attempt)) + Math.floor(random() * 250);
}
