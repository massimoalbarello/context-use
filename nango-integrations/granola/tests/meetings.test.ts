import { describe, expect, it } from "bun:test";

import { MANAGED_FUNCTIONS, MANAGED_INTEGRATIONS } from "../../catalog.js";
import { FakeNango } from "../../test-support/fake-nango.js";
import sync, { type NangoSyncLocal } from "../syncs/meetings.js";

function asNango(fake: FakeNango): NangoSyncLocal {
  return fake as unknown as NangoSyncLocal;
}

function toolResponse(text: string): unknown {
  return {
    jsonrpc: "2.0",
    id: 1,
    result: { content: [{ type: "text", text }], isError: false },
  };
}

describe("Granola MCP meeting sync", () => {
  it("uses the Granola MCP provider and exposes only its pipeline model", () => {
    expect(MANAGED_INTEGRATIONS.find((integration) => integration.id === "granola")).toEqual({
      id: "granola",
      provider: "granola-mcp",
      displayName: "Granola",
      forwardWebhooks: false,
      setup: "manual",
    });
    expect(MANAGED_FUNCTIONS.find((fn) => fn.integrationId === "granola")).toEqual({
      integrationId: "granola",
      name: "meetings",
      type: "sync",
      models: ["GranolaMeeting"],
      pipelineModels: ["GranolaMeeting"],
    });
  });

  it("stores the complete generated summary as a compact pipeline record", async () => {
    const fake = new FakeNango();
    fake.setResponse("mcp:tools/call:list_meetings", toolResponse(`
      <meetings_data count="1">
        <meeting id="meeting-123" title="Product &amp; roadmap" date="Aug 1, 2026 2:30 PM">
          <known_participants>Max (note creator) &lt;max@example.com&gt;, Ada &lt;ada@example.com&gt;</known_participants>
        </meeting>
      </meetings_data>`));
    fake.setResponse("mcp:tools/call:get_meetings", toolResponse(`
      <meetings_data count="1">
        <meeting id="meeting-123" title="Product &amp; roadmap" date="Aug 1, 2026 2:30 PM">
          <known_participants>Max (note creator) &lt;max@example.com&gt;, Ada &lt;ada@example.com&gt;</known_participants>
          <private_notes>Provider-only private sentinel</private_notes>
          <summary>## Decisions

- Ship the complete ingestion path.

## Actions

- Ada owns schema validation.
- Max owns deployment.</summary>
          <provider_debug>Provider-only debug sentinel</provider_debug>
        </meeting>
      </meetings_data>`));

    await sync.exec(asNango(fake));

    expect(fake.postCalls.map((call) => (call.data as { params: { name: string } }).params.name)).toEqual([
      "list_meetings",
      "get_meetings",
    ]);
    const batch = fake.savedBatches.find((saved) => saved.model === "GranolaMeeting");
    expect(batch?.records).toHaveLength(1);
    const record = sync.models.GranolaMeeting.parse(batch?.records[0]);
    expect(Object.keys(record).sort()).toEqual(["body", "created_at", "id", "participants", "updated_at"]);
    expect(record.participants).toEqual(["ada@example.com", "max@example.com"]);
    expect(record.body).toContain("# Product & roadmap");
    expect(record.body).toContain("- Date: Aug 1, 2026 2:30 PM");
    expect(record.body).toContain("- Granola: https://notes.granola.ai/d/meeting-123");
    expect(record.body).toContain("- Attendees: Ada <ada@example.com>, Max <max@example.com>");
    expect(record.body).toContain("## Decisions\n\n- Ship the complete ingestion path.");
    expect(record.body).toContain("- Ada owns schema validation.\n- Max owns deployment.");
    expect(record.body).not.toContain("Provider-only private sentinel");
    expect(record.body).not.toContain("Provider-only debug sentinel");
  });

  it("does not save meetings without a generated summary", async () => {
    const fake = new FakeNango();
    const meeting = `<meeting id="empty" title="Empty" date="Aug 1, 2026 2:30 PM"><known_participants></known_participants></meeting>`;
    fake.setResponse("mcp:tools/call:list_meetings", toolResponse(`<meetings_data>${meeting}</meetings_data>`));
    fake.setResponse("mcp:tools/call:get_meetings", toolResponse(`<meetings_data>${meeting}</meetings_data>`));
    await sync.exec(asNango(fake));
    expect(fake.savedBatches).toEqual([]);
  });
});
