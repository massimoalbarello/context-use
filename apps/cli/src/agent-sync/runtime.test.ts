import { expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { renderLaunchAgent } from "./launchd.ts";
import { probeAgentSync, pushAgentConversations } from "./remote.ts";
import { runAgentSync } from "./runtime.ts";
import type { AgentSyncConfig } from "./types.ts";

test("runtime checkpoints accepted batches and uploads only later changes", async () => {
  const root = join(tmpdir(), `context-use-agent-sync-runtime-${crypto.randomUUID()}`);
  await mkdir(root, { recursive: true });
  const transcript = join(root, "session.jsonl");
  const first = [
    { type: "session_meta", timestamp: "2026-08-01T10:00:00Z", payload: { id: "runtime-session" } },
    { type: "response_item", timestamp: "2026-08-01T10:00:01Z", payload: { type: "message", role: "user", content: "Hello" } },
  ];
  await writeFile(transcript, jsonl(first));
  const requests: unknown[] = [];
  const fetcher = (async (_input: string | URL | Request, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)) as unknown);
    return Response.json({ accepted: true }, { status: 202 });
  }) as typeof fetch;
  const config: AgentSyncConfig = {
    schemaVersion: 1,
    deploymentId: "deployment",
    connectionId: "agent-sync",
    webhookUrl: "https://nango.example.com/webhooks/agent",
    installedAt: "2026-08-01T00:00:00.000Z",
    label: "laptop",
  };
  const dependencies = {
    config,
    token: "a".repeat(43),
    roots: [{ source: "codex" as const, root }],
    statePath: join(root, "state.sqlite"),
    lockPath: join(root, "run.lock"),
    now: () => Date.parse("2026-08-01T11:00:00Z"),
    fetcher,
    pause: async () => {},
    batchId: () => "batch",
  };
  try {
    expect(await runAgentSync(dependencies)).toMatchObject({ changed: 1, accepted: 1, pending: 0 });
    expect(await runAgentSync(dependencies)).toMatchObject({ changed: 0, accepted: 0, pending: 0 });
    expect(requests).toHaveLength(1);

    await writeFile(transcript, jsonl([...first,
      { type: "response_item", timestamp: "2026-08-01T10:00:02Z", payload: { type: "message", role: "assistant", phase: "final_answer", content: "Hi" } },
      { type: "event_msg", timestamp: "2026-08-01T10:00:03Z", payload: { type: "user_message", message: "One more question" } },
      { type: "event_msg", timestamp: "2026-08-01T10:00:04Z", payload: { type: "agent_message", phase: "final_answer", message: "One more answer" } },
    ]));
    expect(await runAgentSync(dependencies)).toMatchObject({ changed: 1, accepted: 1, pending: 0 });
    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({
      type: "agent.conversation.upsert",
      connectionId: "agent-sync",
      batchId: "batch",
    });
    expect(requests[1]).toMatchObject({ records: [{ body: expect.stringContaining("One more answer") }] });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("remote retries transient failures without leaking the token into the payload", async () => {
  const requests: Array<{ authorization: string | null; body: string }> = [];
  const pauses: number[] = [];
  let attempt = 0;
  const fetcher = (async (_input: string | URL | Request, init?: RequestInit) => {
    requests.push({ authorization: new Headers(init?.headers).get("Authorization"), body: String(init?.body) });
    attempt += 1;
    return attempt === 1
      ? Response.json({}, { status: 503 })
      : Response.json({ accepted: true }, { status: 202 });
  }) as typeof fetch;
  const token = "s".repeat(43);
  await pushAgentConversations("https://nango.example.com/hook", token, {
    type: "agent.conversation.upsert",
    connectionId: "agent-sync",
    batchId: "batch",
    sentAt: "2026-08-01T10:00:00.000Z",
    records: [{
      id: "one",
      created_at: "2026-08-01T09:00:00.000Z",
      updated_at: "2026-08-01T10:00:00.000Z",
      participants: [],
      body: "# Conversation",
    }],
  }, { fetcher, pause: async (ms) => { pauses.push(ms); }, random: () => 0 });

  expect(requests).toHaveLength(2);
  expect(requests.every((request) => request.authorization === `Bearer ${token}`)).toBe(true);
  expect(requests.every((request) => !request.body.includes(token))).toBe(true);
  expect(pauses).toEqual([500]);
});

test("status probes and launch configuration contain no management or daemon secret", async () => {
  const token = "z".repeat(43);
  const fetcher = (async (_input: string | URL | Request, init?: RequestInit) => {
    expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${token}`);
    expect(JSON.parse(String(init?.body))).toEqual({
      type: "nango.authenticated-webhook.status",
      connectionId: "agent-sync",
    });
    return Response.json({ active: true });
  }) as typeof fetch;
  expect(await probeAgentSync("https://nango.example.com/hook", token, "agent-sync", { fetcher })).toBe(true);

  const plist = renderLaunchAgent("/usr/local/bin/context-use");
  expect(plist).toContain("<string>/usr/local/bin/context-use</string>");
  expect(plist).toContain("<string>sync-now</string>");
  expect(plist).toContain("<integer>1800</integer>");
  expect(plist).not.toContain(token);
  expect(plist).not.toContain("NANGO_");
});

function jsonl(records: unknown[]): string {
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}
