import { describe, expect, test } from "bun:test";
import {
  NangoRecordReader,
  PIPELINE_RECORD_SOURCES,
  SourceRecordCheckpointError,
  type PipelineRecordSource,
} from "./nango-records.ts";

const GITHUB: PipelineRecordSource = {
  integrationId: "github",
  model: "GitHubPullRequest",
};
const GRANOLA: PipelineRecordSource = {
  integrationId: "granola",
  model: "GranolaMeeting",
};
const AGENT_CONVERSATIONS: PipelineRecordSource = {
  integrationId: "agent-conversations",
  model: "AgentConversation",
};
const NOW = new Date("2026-08-01T12:00:00.000Z");
const INITIAL_FRESHNESS_CUTOFF = "2026-07-02T12:00:00.000Z";

function pipelineRecord(
  id: string,
  body: string,
  cursor: string,
  action: "ADDED" | "UPDATED" | "DELETED" = "ADDED",
  updatedAt = "2026-07-31T11:00:00.000Z",
) {
  return {
    id,
    created_at: "2026-07-31T10:00:00.000Z",
    updated_at: updatedAt,
    participants: ["owner"],
    body,
    _nango_metadata: {
      first_seen_at: "2026-07-31T10:00:00.000Z",
      last_modified_at: "2026-07-31T11:00:00.000Z",
      last_action: action,
      deleted_at: action === "DELETED" ? "2026-07-31T11:00:00.000Z" : null,
      pruned_at: null,
      cursor,
    },
  };
}

function reader(
  fetcher: (request: Request) => Promise<Response>,
  options: {
    sources?: PipelineRecordSource[];
    responseByteBudget?: number;
    now?: () => Date;
  } = {},
) {
  return new NangoRecordReader({
    baseUrl: "http://nango-server:3003",
    apiKey: "pipeline-secret",
    fetcher: async (input, init) => fetcher(new Request(input, init)),
    now: options.now ?? (() => NOW),
    ...(options.sources ? { sources: options.sources } : {}),
    ...(options.responseByteBudget ? { responseByteBudget: options.responseByteBudget } : {}),
  });
}

describe("Nango source-record reader", () => {
  test("declares only canonical pipeline models from the managed integration catalog", () => {
    expect(PIPELINE_RECORD_SOURCES).toEqual([GITHUB, GRANOLA, AGENT_CONVERSATIONS]);
    expect(PIPELINE_RECORD_SOURCES.map(({ model }) => model)).not.toContain("GitHubRepositorySyncState");
  });

  test("combines canonical Markdown across integrations and connections without exposing provider JSON", async () => {
    const sources = [
      GITHUB,
      { integrationId: "slack", model: "SlackThread" },
    ];
    const seen: Request[] = [];
    const sourceReader = reader(async (request) => {
      seen.push(request);
      const url = new URL(request.url);
      expect(request.headers.get("authorization")).toBe("Bearer pipeline-secret");
      if (url.pathname === "/connections") {
        const integrationId = url.searchParams.get("integrationId")!;
        return Response.json({
          connections: [{
            id: integrationId === "github" ? 1 : 2,
            connection_id: `${integrationId}-connection`,
            provider_config_key: integrationId,
            provider_payload_that_must_not_escape: true,
          }],
        });
      }
      const integrationId = request.headers.get("provider-config-key")!;
      return Response.json({
        records: [pipelineRecord(
          `${integrationId}-1`,
          `# ${integrationId} activity\n\nCanonical source Markdown.`,
          `${integrationId}-cursor`,
        )],
        next_cursor: null,
      });
    }, { sources });

    const result = await sourceReader.read({ limit: 10 });

    expect(result.has_more).toBe(false);
    expect(result.records).toHaveLength(2);
    expect(result.records.map(({ markdown }) => markdown).sort()).toEqual([
      "# github activity\n\nCanonical source Markdown.",
      "# slack activity\n\nCanonical source Markdown.",
    ]);
    expect(result.records.every((record) => Object.keys(record).sort().join(",") === "action,markdown")).toBe(true);
    expect(result.records.every(({ action }) => action === "added")).toBe(true);
    expect(seen.filter((request) => new URL(request.url).pathname === "/connections")).toHaveLength(2);
    expect(seen.some((request) => new URL(request.url).pathname === "/scripts/config")).toBe(false);
  });

  test("uses the last returned cursor so a completed checkpoint yields only later records", async () => {
    const cursorsSeen: Array<string | null> = [];
    const modifiedAfterSeen: Array<string | null> = [];
    const sourceReader = reader(async (request) => {
      const url = new URL(request.url);
      if (url.pathname === "/connections") {
        return Response.json({ connections: [{ id: 1, connection_id: "owner", provider_config_key: "github" }] });
      }
      const cursor = url.searchParams.get("cursor");
      cursorsSeen.push(cursor);
      modifiedAfterSeen.push(url.searchParams.get("modified_after"));
      if (cursor === null) {
        return Response.json({
          records: [pipelineRecord("1", "# First", "cursor-one")],
          next_cursor: "more",
        });
      }
      if (cursor === "cursor-one") {
        return Response.json({
          records: [pipelineRecord("2", "# Second", "cursor-two")],
          next_cursor: null,
        });
      }
      return Response.json({
        records: [pipelineRecord("3", "# Later", "cursor-three")],
        next_cursor: null,
      });
    }, { sources: [GITHUB] });

    const first = await sourceReader.read({ limit: 1 });
    expect(first.records.map(({ markdown }) => markdown)).toEqual(["# First"]);
    expect(first.has_more).toBe(true);
    expect(first.next_checkpoint).toStartWith("cu-nango-v1.");
    expect(first.next_checkpoint).not.toContain("owner");
    expect(first.next_checkpoint).not.toContain("cursor-one");
    const editedCheckpoint = `${first.next_checkpoint.slice(0, -1)}${first.next_checkpoint.endsWith("a") ? "b" : "a"}`;
    await expect(sourceReader.read({ checkpoint: editedCheckpoint, limit: 1 }))
      .rejects.toBeInstanceOf(SourceRecordCheckpointError);

    const second = await sourceReader.read({ checkpoint: first.next_checkpoint, limit: 1 });
    expect(second.records.map(({ markdown }) => markdown)).toEqual(["# Second"]);
    expect(second.has_more).toBe(false);

    const nextTrigger = await sourceReader.read({ checkpoint: second.next_checkpoint, limit: 1 });
    expect(nextTrigger.records.map(({ markdown }) => markdown)).toEqual(["# Later"]);
    expect(nextTrigger.has_more).toBe(false);
    expect(cursorsSeen).toEqual([null, "cursor-one", "cursor-two"]);
    expect(modifiedAfterSeen).toEqual([INITIAL_FRESHNESS_CUTOFF, null, null]);
  });

  test("starts newly discovered connections from the current one-month window while retaining prior cursors", async () => {
    let includeSecondConnection = false;
    let now = NOW;
    const cursors = new Map<string, Array<string | null>>();
    const modifiedAfter = new Map<string, Array<string | null>>();
    const sourceReader = reader(async (request) => {
      const url = new URL(request.url);
      if (url.pathname === "/connections") {
        return Response.json({
          connections: [
            { id: 1, connection_id: "first", provider_config_key: "github" },
            ...(includeSecondConnection ? [{ id: 2, connection_id: "second", provider_config_key: "github" }] : []),
          ],
        });
      }
      const connection = request.headers.get("connection-id")!;
      const cursor = url.searchParams.get("cursor");
      cursors.set(connection, [...cursors.get(connection) ?? [], cursor]);
      modifiedAfter.set(connection, [
        ...(modifiedAfter.get(connection) ?? []),
        url.searchParams.get("modified_after"),
      ]);
      if (connection === "first" && cursor === null) {
        return Response.json({ records: [pipelineRecord("1", "# Existing", "first-cursor")], next_cursor: null });
      }
      if (connection === "second" && cursor === null) {
        return Response.json({
          records: [pipelineRecord(
            "2",
            "# Newly connected",
            "second-cursor",
            "ADDED",
            "2026-08-31T11:00:00.000Z",
          )],
          next_cursor: null,
        });
      }
      return Response.json({ records: [], next_cursor: null });
    }, { sources: [GITHUB], now: () => now });

    const first = await sourceReader.read({ limit: 10 });
    includeSecondConnection = true;
    now = new Date("2026-09-01T12:00:00.000Z");
    const second = await sourceReader.read({ checkpoint: first.next_checkpoint, limit: 10 });

    expect(second.records.map(({ markdown }) => markdown)).toEqual(["# Newly connected"]);
    expect(cursors.get("first")).toEqual([null, "first-cursor"]);
    expect(cursors.get("second")).toEqual([null]);
    expect(modifiedAfter.get("first")).toEqual([INITIAL_FRESHNESS_CUTOFF, null]);
    expect(modifiedAfter.get("second")).toEqual(["2026-08-02T12:00:00.000Z"]);
  });

  test("skips source history older than the current freshness window while advancing its cursor", async () => {
    const cursorsSeen: Array<string | null> = [];
    const sourceReader = reader(async (request) => {
      const url = new URL(request.url);
      if (url.pathname === "/connections") {
        return Response.json({ connections: [{ id: 1, connection_id: "owner", provider_config_key: "github" }] });
      }
      const cursor = url.searchParams.get("cursor");
      cursorsSeen.push(cursor);
      return cursor === null
        ? Response.json({
            records: [pipelineRecord("old", "# Old activity", "old-cursor", "ADDED", "2026-06-01T10:00:00.000Z")],
            next_cursor: "more",
          })
        : Response.json({
            records: [pipelineRecord("recent", "# Recent activity", "recent-cursor")],
            next_cursor: null,
          });
    }, { sources: [GITHUB] });

    const first = await sourceReader.read({ limit: 1 });
    expect(first.records).toEqual([]);
    expect(first.has_more).toBe(true);

    const second = await sourceReader.read({ checkpoint: first.next_checkpoint, limit: 1 });
    expect(second.records.map(({ markdown }) => markdown)).toEqual(["# Recent activity"]);
    expect(second.has_more).toBe(false);
    expect(cursorsSeen).toEqual([null, "old-cursor"]);
  });

  test("applies the rolling freshness window to an existing checkpoint backlog", async () => {
    let now = NOW;
    const cursorsSeen: Array<string | null> = [];
    const sourceReader = reader(async (request) => {
      const url = new URL(request.url);
      if (url.pathname === "/connections") {
        return Response.json({ connections: [{ id: 1, connection_id: "owner", provider_config_key: "github" }] });
      }
      const cursor = url.searchParams.get("cursor");
      cursorsSeen.push(cursor);
      return cursor === null
        ? Response.json({
            records: [pipelineRecord(
              "1",
              "# Initially recent",
              "cursor-one",
              "ADDED",
              "2026-07-15T10:00:00.000Z",
            )],
            next_cursor: "more",
          })
        : Response.json({
            records: [pipelineRecord(
              "2",
              "# Aged backlog",
              "cursor-two",
              "ADDED",
              "2026-07-15T11:00:00.000Z",
            )],
            next_cursor: null,
          });
    }, { sources: [GITHUB], now: () => now });

    const first = await sourceReader.read({ limit: 1 });
    expect(first.records.map(({ markdown }) => markdown)).toEqual(["# Initially recent"]);
    expect(first.has_more).toBe(true);

    now = new Date("2026-09-01T12:00:00.000Z");
    const second = await sourceReader.read({ checkpoint: first.next_checkpoint, limit: 1 });
    expect(second.records).toEqual([]);
    expect(second.has_more).toBe(false);
    expect(cursorsSeen).toEqual([null, "cursor-one"]);
  });

  test("returns recently updated records even when their underlying activity is old", async () => {
    const sourceReader = reader(async (request) => {
      const url = new URL(request.url);
      if (url.pathname === "/connections") {
        return Response.json({ connections: [{ id: 1, connection_id: "owner", provider_config_key: "github" }] });
      }
      return Response.json({
        records: [{
          ...pipelineRecord("old-updated", "# Older activity updated recently", "cursor", "UPDATED"),
          created_at: "2024-01-10T10:00:00.000Z",
        }],
        next_cursor: null,
      });
    }, { sources: [GITHUB] });

    const result = await sourceReader.read({ limit: 10 });

    expect(result.records).toEqual([expect.objectContaining({
      action: "updated",
      markdown: "# Older activity updated recently",
    })]);
    expect(result.has_more).toBe(false);
  });

  test("treats a re-created Nango connection as a new stream even when its public ID is reused", async () => {
    let connectionInstanceId = 1;
    const cursorsSeen: Array<string | null> = [];
    const sourceReader = reader(async (request) => {
      const url = new URL(request.url);
      if (url.pathname === "/connections") {
        return Response.json({
          connections: [{
            id: connectionInstanceId,
            connection_id: "reused-owner-id",
            provider_config_key: "github",
          }],
        });
      }
      const cursor = url.searchParams.get("cursor");
      cursorsSeen.push(cursor);
      return Response.json({
        records: [pipelineRecord(String(connectionInstanceId), "# Activity", `cursor-${connectionInstanceId}`)],
        next_cursor: null,
      });
    }, { sources: [GITHUB] });

    const first = await sourceReader.read({ limit: 10 });
    connectionInstanceId = 2;
    await sourceReader.read({ checkpoint: first.next_checkpoint, limit: 10 });

    expect(cursorsSeen).toEqual([null, null]);
  });

  test("does not advance past a record omitted by the response byte budget", async () => {
    const cursorsSeen: Array<string | null> = [];
    const sourceReader = reader(async (request) => {
      const url = new URL(request.url);
      if (url.pathname === "/connections") {
        return Response.json({ connections: [{ id: 1, connection_id: "owner", provider_config_key: "github" }] });
      }
      const cursor = url.searchParams.get("cursor");
      cursorsSeen.push(cursor);
      const records = cursor === null
        ? [pipelineRecord("1", "A".repeat(100), "cursor-one"), pipelineRecord("2", "B".repeat(100), "cursor-two")]
        : [pipelineRecord("2", "B".repeat(100), "cursor-two")];
      return Response.json({ records, next_cursor: null });
    }, { sources: [GITHUB], responseByteBudget: 200 });

    const first = await sourceReader.read({ limit: 10 });
    expect(first.records).toHaveLength(1);
    expect(first.has_more).toBe(true);
    const second = await sourceReader.read({ checkpoint: first.next_checkpoint, limit: 10 });
    expect(second.records.map(({ markdown }) => markdown)).toEqual(["B".repeat(100)]);
    expect(cursorsSeen).toEqual([null, "cursor-one"]);
  });

  test("serves a large agent conversation as ordered fresh-session working sets", async () => {
    const cursorsSeen: Array<string | null> = [];
    const body = [
      "# Agent conversation",
      ...Array.from({ length: 24 }, (_, index) => [
        "",
        `### ${index % 2 === 0 ? "User" : "Assistant"}`,
        "",
        `turn-${index + 1}-${"x".repeat(1_500)}`,
      ]).flat(),
    ].join("\n");
    const sourceReader = reader(async (request) => {
      const url = new URL(request.url);
      if (url.pathname === "/connections") {
        return Response.json({
          connections: [{ id: 1, connection_id: "owner", provider_config_key: "agent-conversations" }],
        });
      }
      const cursor = url.searchParams.get("cursor");
      cursorsSeen.push(cursor);
      return cursor === null
        ? Response.json({ records: [pipelineRecord("large", body, "cursor-one")], next_cursor: null })
        : Response.json({ records: [], next_cursor: null });
    }, { sources: [AGENT_CONVERSATIONS] });

    const first = await sourceReader.read({ limit: 50 });
    expect(first.records).toHaveLength(1);
    expect(first.records[0]?.markdown).toContain("## Conversation to process");
    expect(first.records[0]?.markdown).not.toContain("Context from immediately before this excerpt");
    expect(first.has_more).toBe(true);

    const second = await sourceReader.read({ checkpoint: first.next_checkpoint, limit: 50 });
    expect(second.records).toHaveLength(1);
    expect(second.records[0]?.markdown).toContain("## Context from immediately before this excerpt");
    expect(second.records[0]?.markdown).toContain("already processed");
    expect(second.has_more).toBe(false);
    expect(cursorsSeen).toEqual([null, null]);
  });

  test("restarts segmentation when a pending conversation receives a newer source version", async () => {
    const body = (version: string) => [
      "# Agent conversation",
      ...Array.from({ length: 24 }, (_, index) => [
        "",
        `### ${index % 2 === 0 ? "User" : "Assistant"}`,
        "",
        `${version}-turn-${index + 1}-${"x".repeat(1_500)}`,
      ]).flat(),
    ].join("\n");
    let currentVersion = "old";
    const sourceReader = reader(async (request) => {
      const url = new URL(request.url);
      if (url.pathname === "/connections") {
        return Response.json({
          connections: [{ id: 1, connection_id: "owner", provider_config_key: "agent-conversations" }],
        });
      }
      return Response.json({
        records: [pipelineRecord(
          "growing",
          body(currentVersion),
          currentVersion === "old" ? "cursor-old" : "cursor-new",
          currentVersion === "old" ? "ADDED" : "UPDATED",
        )],
        next_cursor: null,
      });
    }, { sources: [AGENT_CONVERSATIONS] });

    const first = await sourceReader.read({ limit: 50 });
    expect(first.records[0]?.markdown).toContain("old-turn-1-");
    currentVersion = "new";
    const restarted = await sourceReader.read({ checkpoint: first.next_checkpoint, limit: 50 });
    expect(restarted.records[0]?.action).toBe("updated");
    expect(restarted.records[0]?.markdown).toContain("new-turn-1-");
    expect(restarted.records[0]?.markdown).not.toContain("Context from immediately before this excerpt");
  });

  test("preserves deletion lifecycle and advances past a pruned tombstone", async () => {
    let read = 0;
    const sourceReader = reader(async (request) => {
      const url = new URL(request.url);
      if (url.pathname === "/connections") {
        return Response.json({ connections: [{ id: 1, connection_id: "owner", provider_config_key: "github" }] });
      }
      read += 1;
      return read === 1
        ? Response.json({
            records: [pipelineRecord("1", "# Withdrawn activity", "cursor-one", "DELETED")],
            next_cursor: "more",
          })
        : Response.json({
            records: [{
              id: "2",
              _nango_metadata: {
                first_seen_at: "2026-07-31T10:00:00.000Z",
                last_modified_at: "2026-07-31T11:00:00.000Z",
                last_action: "DELETED",
                deleted_at: "2026-07-31T11:00:00.000Z",
                pruned_at: "2026-08-01T10:00:00.000Z",
                cursor: "cursor-two",
              },
            }],
            next_cursor: null,
          });
    }, { sources: [GITHUB] });

    const first = await sourceReader.read({ limit: 1 });
    expect(first.records).toEqual([expect.objectContaining({
      action: "deleted",
      markdown: "# Withdrawn activity",
    })]);

    const second = await sourceReader.read({ checkpoint: first.next_checkpoint, limit: 1 });
    expect(second.records).toEqual([expect.objectContaining({
      action: "deleted",
      markdown: null,
    })]);
    expect(second.has_more).toBe(false);
  });

  test("fails closed for edited checkpoints and non-canonical record envelopes", async () => {
    const sourceReader = reader(async (request) => {
      const url = new URL(request.url);
      if (url.pathname === "/connections") {
        return Response.json({ connections: [{ id: 1, connection_id: "owner", provider_config_key: "github" }] });
      }
      return Response.json({
        records: [{ ...pipelineRecord("1", "# Record", "cursor"), repository: "must-not-leak" }],
        next_cursor: null,
      });
    }, { sources: [GITHUB] });

    await expect(sourceReader.read({ checkpoint: "not-a-checkpoint" }))
      .rejects.toBeInstanceOf(SourceRecordCheckpointError);
    await expect(sourceReader.read({ limit: 10 })).rejects.toThrow();
  });
});
