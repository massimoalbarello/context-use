import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  captureTranscript,
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
    { source: "claude-cowork", root: "/Users/tester/Library/Application Support/Claude/local-agent-mode-sessions" },
  ]);
});

test("Codex transcripts become stable universal Markdown records", () => {
  const content = lines([
    { type: "session_meta", timestamp: "2026-08-01T10:00:00.000Z", payload: { id: "codex-session", cwd: "/work/project" } },
    { type: "turn_context", timestamp: "2026-08-01T10:00:00.500Z", payload: { model: "gpt-5" } },
    { type: "response_item", timestamp: "2026-08-01T10:00:00.800Z", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context>secret bootstrap data</environment_context>" }] } },
    { type: "event_msg", timestamp: "2026-08-01T10:00:01.000Z", payload: { type: "user_message", message: "Repeat this" } },
    { type: "response_item", timestamp: "2026-08-01T10:00:01.010Z", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Repeat this" }] } },
    { type: "response_item", timestamp: "2026-08-01T10:00:02.000Z", payload: { type: "custom_tool_call", name: "exec", input: "{\"cmd\":\"pwd\"}" } },
    { type: "response_item", timestamp: "2026-08-01T10:00:02.100Z", payload: { type: "custom_tool_call_output", output: [{ type: "text", text: "/work/project" }] } },
    { type: "event_msg", timestamp: "2026-08-01T10:00:02.500Z", payload: { type: "agent_message", phase: "commentary", message: "Working on it" } },
    { type: "event_msg", timestamp: "2026-08-01T10:00:03.000Z", payload: { type: "agent_message", phase: "final_answer", message: "Done" } },
    { type: "response_item", timestamp: "2026-08-01T10:00:03.010Z", payload: { type: "message", role: "assistant", phase: "final_answer", content: [{ type: "output_text", text: "Done" }] } },
    { type: "event_msg", timestamp: "2026-08-01T10:00:10.000Z", payload: { type: "user_message", message: "Repeat this" } },
  ]);

  const record = conversationRecord(parseTranscript("codex", content, 0));
  expect(Object.keys(record)).toEqual(["id", "created_at", "updated_at", "participants", "body"]);
  expect(record.id).toMatch(/^ac1_[A-Za-z0-9_-]{43}$/);
  expect(record.participants).toEqual([]);
  expect(record.created_at).toBe("2026-08-01T10:00:00.000Z");
  expect(record.updated_at).toBe("2026-08-01T10:00:10.000Z");
  expect(record.body).not.toContain("Native session");
  expect(record.body).not.toContain("Workspace:");
  expect(record.body).not.toContain("Model:");
  expect(record.body).not.toContain("### Tool:");
  expect(record.body).not.toContain("Working on it");
  expect(record.body).not.toContain("secret bootstrap data");
  expect(record.body.match(/### User/g)).toHaveLength(2);
  expect(record.body.match(/### Assistant/g)).toHaveLength(1);
  expect(record.body).not.toContain("provider");
});

test("Claude Code and workspace sessions have distinct identities and transcript-only bodies", () => {
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
  expect(code.body).toContain("### User");
  expect(workspace.body).toContain("### Assistant");
  expect(code.body).not.toContain("### Tool:");
  expect(code.body).not.toContain("private chain of thought");
});

test("incomplete tails are retried safely and large bodies remain lossless", () => {
  const incomplete = `${lines([
    { type: "session_meta", timestamp: "2026-08-01T10:00:00Z", payload: { id: "partial" } },
    { type: "response_item", timestamp: "2026-08-01T10:00:01Z", payload: { type: "message", role: "user", content: "Hello" } },
  ])}{\"type\":`;
  const partial = conversationRecord(parseTranscript("codex", incomplete, 0));
  expect(partial.body).toContain("### User");

  const large = conversationRecord({
    source: "codex",
    sessionId: "large",
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-01T10:00:01.000Z",
    messages: [{ role: "user", text: `BEGIN-${"x".repeat(900_000)}-END` }],
    incomplete: false,
  });
  expect(Buffer.byteLength(large.body, "utf8")).toBeGreaterThan(768 * 1024);
  expect(large.body).toContain("BEGIN-");
  expect(large.body).toContain("-END");
  expect(large.body).not.toContain("truncated the middle");
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
    const files = await discoverTranscriptFiles([
      { source: "codex", root },
      { source: "codex", root: join(root, "nested") },
    ]);
    expect(files).toHaveLength(1);
    const captured = await captureTranscript(files[0]!);
    expect(captured.fileHash).toMatch(/^[a-f0-9]{64}$/);
    expect(captured.record.body).not.toContain(root);
    expect(captured.record.body).not.toContain("portable-id");
    expect(captured.record.id).toBe(conversationRecord(parseTranscript("codex", lines([
      { type: "session_meta", payload: { id: "portable-id" } },
      { type: "response_item", payload: { type: "message", role: "user", content: "Hello" } },
    ]), Date.parse("2026-08-01T10:00:01Z"))).id);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Cowork discovery only reads main Claude project transcripts", async () => {
  const root = await mkdtemp(join(tmpdir(), "context-use-agent-sync-cowork-"));
  const project = join(root, "org", "user", "local_task", ".claude", "projects", "encoded-project");
  await mkdir(join(project, "session", "subagents"), { recursive: true });
  await mkdir(join(root, "org", "user", "local_task", "outputs"), { recursive: true });
  try {
    const transcript = join(project, "session.jsonl");
    await writeFile(transcript, lines([
      { type: "user", sessionId: "cowork-session", message: { role: "user", content: "Question" } },
      { type: "assistant", sessionId: "cowork-session", message: { role: "assistant", content: [
        { type: "thinking", thinking: "hidden" },
        { type: "tool_use", name: "Read", input: { file: "secret" } },
        { type: "text", text: "Final answer" },
      ] } },
    ]));
    await writeFile(join(root, "org", "user", "local_task", "audit.jsonl"), "{}\n");
    await writeFile(join(project, "session", "subagents", "child.jsonl"), "{}\n");
    await writeFile(join(root, "org", "user", "local_task", "outputs", "output.jsonl"), "{}\n");

    const files = await discoverTranscriptFiles([{ source: "claude-cowork", root }]);
    expect(files.map((file) => file.path)).toEqual([transcript]);
    const captured = await captureTranscript(files[0]!);
    expect(captured.record.body).toContain("Question");
    expect(captured.record.body).toContain("Final answer");
    expect(captured.record.body).not.toContain("hidden");
    expect(captured.record.body).not.toContain("secret");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function lines(records: unknown[]): string {
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}
