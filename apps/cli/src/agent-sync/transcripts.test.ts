import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  captureTranscript,
  configuredSourceRoots,
  conversationRecord,
  defaultSourceRoots,
  discoverTranscriptFiles,
  parseTranscript,
} from "./transcripts.ts";

test("default adapters cover Codex, Claude Code, and Claude workspace transcripts", () => {
  expect(defaultSourceRoots("/Users/tester")).toEqual([
    { source: "codex", root: "/Users/tester/.codex/sessions" },
    { source: "codex", root: "/Users/tester/.codex/archived_sessions" },
    { source: "claude-code", root: "/Users/tester/.claude/projects" },
    { source: "claude-cowork", root: "/Users/tester/.codex/claude-cowork-transcript-imports" },
  ]);
});

test("source path overrides replace only their family and normalize persisted paths", () => {
  const defaults = defaultSourceRoots("/Users/tester");
  expect(configuredSourceRoots({
    codex: "~/custom-codex",
    "claude-code": "relative-claude",
  }, defaults, "/Users/tester", "/work/context-use")).toEqual([
    { source: "codex", root: "/Users/tester/custom-codex" },
    { source: "claude-code", root: "/work/context-use/relative-claude" },
    { source: "claude-cowork", root: "/Users/tester/.codex/claude-cowork-transcript-imports" },
  ]);
});

test("Codex transcripts become stable universal Markdown records", () => {
  const content = lines([
    { type: "session_meta", timestamp: "2026-08-01T10:00:00.000Z", payload: { id: "codex-session", cwd: "/work/project" } },
    { type: "turn_context", timestamp: "2026-08-01T10:00:00.500Z", payload: { model: "gpt-5" } },
    { type: "event_msg", timestamp: "2026-08-01T10:00:01.000Z", payload: { type: "user_message", message: "Repeat this" } },
    { type: "response_item", timestamp: "2026-08-01T10:00:01.010Z", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Repeat this" }] } },
    { type: "response_item", timestamp: "2026-08-01T10:00:02.000Z", payload: { type: "custom_tool_call", name: "exec", input: "{\"cmd\":\"pwd\"}" } },
    { type: "response_item", timestamp: "2026-08-01T10:00:02.100Z", payload: { type: "custom_tool_call_output", output: [{ type: "text", text: "/work/project" }] } },
    { type: "event_msg", timestamp: "2026-08-01T10:00:03.000Z", payload: { type: "agent_message", message: "Done" } },
    { type: "response_item", timestamp: "2026-08-01T10:00:03.010Z", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Done" }] } },
    { type: "response_item", timestamp: "2026-08-01T10:00:10.000Z", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Repeat this" }] } },
  ]);

  const record = conversationRecord(parseTranscript("codex", content, 0));
  expect(Object.keys(record)).toEqual(["id", "created_at", "updated_at", "participants", "body"]);
  expect(record.id).toMatch(/^ac1_[A-Za-z0-9_-]{43}$/);
  expect(record.participants).toEqual([]);
  expect(record.created_at).toBe("2026-08-01T10:00:00.000Z");
  expect(record.updated_at).toBe("2026-08-01T10:00:10.000Z");
  expect(record.body).toContain("- Source: Codex / Work");
  expect(record.body).toContain("- Native session: `codex-session`");
  expect(record.body).toContain("- Workspace: project");
  expect(record.body).toContain("### Tool: exec");
  expect(record.body.match(/### User/g)).toHaveLength(2);
  expect(record.body.match(/### Assistant/g)).toHaveLength(1);
  expect(record.body).not.toContain("provider");
});

test("Claude Code and workspace sessions have distinct identities and omit thinking", () => {
  const content = lines([
    { type: "user", sessionId: "claude-session", cwd: "/work/alpha", timestamp: "2026-08-01T09:00:00Z", message: { role: "user", content: "Question" } },
    { type: "assistant", sessionId: "claude-session", timestamp: "2026-08-01T09:00:01Z", message: { role: "assistant", model: "claude", content: [
      { type: "thinking", thinking: "private chain of thought" },
      { type: "text", text: "Answer" },
      { type: "tool_use", name: "Read", input: { file: "README.md" } },
    ] } },
  ]);
  const code = conversationRecord(parseTranscript("claude-code", content, 0));
  const workspace = conversationRecord(parseTranscript("claude-cowork", content, 0));

  expect(code.id).not.toBe(workspace.id);
  expect(code.body).toContain("- Source: Claude Code");
  expect(workspace.body).toContain("- Source: Claude workspace");
  expect(code.body).toContain("### Tool: Read");
  expect(code.body).not.toContain("private chain of thought");
});

test("incomplete tails are retried safely and large bodies preserve their beginning and end", () => {
  const incomplete = `${lines([
    { type: "session_meta", timestamp: "2026-08-01T10:00:00Z", payload: { id: "partial" } },
    { type: "response_item", timestamp: "2026-08-01T10:00:01Z", payload: { type: "message", role: "user", content: "Hello" } },
  ])}{\"type\":`;
  const partial = conversationRecord(parseTranscript("codex", incomplete, 0));
  expect(partial.body).toContain("incomplete JSONL entry");

  const large = conversationRecord({
    source: "codex",
    sessionId: "large",
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-01T10:00:01.000Z",
    messages: [{ role: "user", text: `BEGIN-${"x".repeat(900_000)}-END` }],
    incomplete: false,
  });
  expect(Buffer.byteLength(large.body, "utf8")).toBeLessThanOrEqual(768 * 1024);
  expect(large.body).toContain("BEGIN-");
  expect(large.body).toContain("-END");
  expect(large.body).toContain("truncated the middle");
});

test("discovery and capture use source roots without putting paths in record identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "context-use-agent-sync-discovery-"));
  await mkdir(join(root, "nested"), { recursive: true });
  await mkdir(join(root, "subagents"), { recursive: true });
  try {
    const path = join(root, "nested", "conversation.jsonl");
    await writeFile(path, lines([
      { type: "session_meta", timestamp: "2026-08-01T10:00:00Z", payload: { id: "portable-id" } },
      { type: "response_item", timestamp: "2026-08-01T10:00:01Z", payload: { type: "message", role: "user", content: "Hello" } },
    ]));
    await writeFile(join(root, "subagents", "child.jsonl"), lines([
      { type: "user", sessionId: "portable-id", message: { role: "user", content: "Child task" } },
    ]));
    const files = await discoverTranscriptFiles([{ source: "codex", root }]);
    expect(files).toHaveLength(1);
    const captured = await captureTranscript(files[0]!);
    expect(captured.fileHash).toMatch(/^[a-f0-9]{64}$/);
    expect(captured.record.body).not.toContain(root);
    expect(captured.record.id).toBe(conversationRecord(parseTranscript("codex", lines([
      { type: "session_meta", payload: { id: "portable-id" } },
      { type: "response_item", payload: { type: "message", role: "user", content: "Hello" } },
    ]), Date.parse("2026-08-01T10:00:01Z"))).id);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function lines(records: unknown[]): string {
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}
