import { describe, expect, it } from "bun:test";

import { MANAGED_FUNCTIONS, MANAGED_INTEGRATIONS } from "../../catalog.js";
import { FakeNango } from "../../test-support/fake-nango.js";
import sync, { type AgentConversationNango } from "../syncs/conversations.js";

const record = {
  id: "ac1_record",
  created_at: "2026-08-01T10:00:00.000Z",
  updated_at: "2026-08-01T10:30:00.000Z",
  participants: [],
  body: [
    "# Agent conversation",
    "",
    "- Source: Codex / Work",
    "- Native session: `session-1`",
    "",
    "## Transcript",
    "",
    "### User",
    "",
    "Keep the record connection-specific details in Markdown.",
  ].join("\n"),
};

function asNango(fake: FakeNango): AgentConversationNango {
  return fake as unknown as AgentConversationNango;
}

describe("agent conversation integration contract", () => {
  it("is a hidden managed webhook sync with the universal pipeline model", () => {
    expect(MANAGED_INTEGRATIONS.at(-1)).toEqual({
      id: "agent-conversations",
      provider: "context-use-agent-sync",
      displayName: "Agent Conversations",
      forwardWebhooks: false,
      hidden: true,
    });
    expect(MANAGED_FUNCTIONS.at(-1)).toEqual({
      integrationId: "agent-conversations",
      name: "conversations",
      type: "sync",
      models: ["AgentConversation"],
      pipelineModels: ["AgentConversation"],
    });
    expect(sync.autoStart).toBe(false);
    expect(sync.webhookSubscriptions).toEqual(["agent.conversation.upsert"]);
    expect(Object.keys(sync.models)).toEqual(["AgentConversation"]);
    expect(Object.keys(sync.models.AgentConversation.parse(record))).toEqual([
      "id",
      "created_at",
      "updated_at",
      "participants",
      "body",
    ]);
  });

  it("saves current records and discards stale retries", async () => {
    const fake = new FakeNango();
    fake.setRecord("AgentConversation", record.id, {
      ...record,
      updated_at: "2026-08-01T10:15:00.000Z",
      body: "# Older body",
      provider_only_field: "must not escape",
    });

    await sync.onWebhook(asNango(fake), {
      type: "agent.conversation.upsert",
      connectionId: "agent-sync",
      batchId: "batch-1",
      sentAt: "2026-08-01T10:31:00.000Z",
      records: [
        record,
        { ...record, updated_at: "2026-08-01T10:05:00.000Z", body: "# Stale duplicate" },
      ],
    });

    expect(fake.savedBatches).toEqual([{ model: "AgentConversation", records: [record] }]);
    expect(JSON.stringify(fake.savedBatches)).not.toContain("provider_only_field");
    expect(record.body).toContain("Native session");
    expect(record.body).toContain("Keep the record connection-specific details in Markdown.");
  });

  it("does not rewrite an already-current record", async () => {
    const fake = new FakeNango();
    fake.setRecord("AgentConversation", record.id, record);
    await sync.onWebhook(asNango(fake), {
      type: "agent.conversation.upsert",
      connectionId: "agent-sync",
      batchId: "batch-2",
      sentAt: "2026-08-01T10:31:00.000Z",
      records: [record],
    });
    expect(fake.savedBatches).toEqual([]);
  });
});
