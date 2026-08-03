import { createSync } from "nango";
import { z } from "zod";

import { PipelineRecordSchema, type PipelineRecord } from "../../pipeline-record.js";

const MODEL = "AgentConversation" as const;
const WEBHOOK_TYPE = "agent.conversation.upsert";
const MAX_RECORDS_PER_REQUEST = 100;

const WebhookPayloadSchema = z.object({
  type: z.literal(WEBHOOK_TYPE),
  connectionId: z.string().min(1),
  batchId: z.string().min(1).max(200),
  sentAt: z.iso.datetime({ offset: true }),
  records: z.array(PipelineRecordSchema).min(1).max(MAX_RECORDS_PER_REQUEST),
}).strict();

const sync = createSync({
  description: "Store Markdown-first local agent conversations pushed by Context Use agent-sync",
  version: "1.0.0",
  frequency: "every day",
  autoStart: false,
  webhookSubscriptions: [WEBHOOK_TYPE],
  models: {
    AgentConversation: PipelineRecordSchema,
  },
  exec: async (nango) => {
    await nango.log("Agent conversations are pushed by the local Context Use agent-sync daemon.");
  },
  onWebhook: async (nango, rawPayload) => {
    const payload = WebhookPayloadSchema.parse(rawPayload);
    const newest = newestRecords(payload.records);
    const existing = await nango.getRecordsByIds<string, PipelineRecord>(
      newest.map((record) => record.id),
      MODEL,
    );
    const current = newest.filter((record) => {
      const stored = existing.get(record.id);
      return !stored || record.updated_at > stored.updated_at;
    });

    if (current.length > 0) {
      await nango.batchSave(current, MODEL);
    }
    await nango.log(
      `Accepted ${current.length} current agent conversation record(s); ignored ${newest.length - current.length} stale or duplicate record(s).`,
    );
  },
});

function newestRecords(records: PipelineRecord[]): PipelineRecord[] {
  const newest = new Map<string, PipelineRecord>();
  for (const record of records) {
    const prior = newest.get(record.id);
    if (!prior || record.updated_at > prior.updated_at) newest.set(record.id, record);
  }
  return [...newest.values()].sort((left, right) => left.id.localeCompare(right.id));
}

export type AgentConversationNango = Parameters<(typeof sync)["exec"]>[0];
export { WebhookPayloadSchema, newestRecords };
export default sync;
