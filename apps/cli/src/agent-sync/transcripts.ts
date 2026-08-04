import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, sep } from "node:path";

import { AgentConversationRecordSchema, type AgentConversationRecord } from "./record.ts";
import type {
  AgentMessage,
  AgentSource,
  CapturedConversation,
  ParsedConversation,
  SourceRoot,
  TranscriptFile,
} from "./types.ts";

const MAX_BODY_BYTES = 768 * 1024;

export type { SourceRoot } from "./types.ts";
export type DiscoveryErrorHandler = (source: AgentSource, path: string, error: unknown) => void;

export function defaultSourceRoots(home = homedir()): SourceRoot[] {
  return [
    { source: "codex", root: join(home, ".codex", "sessions") },
    { source: "codex", root: join(home, ".codex", "archived_sessions") },
    { source: "claude-code", root: join(home, ".claude", "projects") },
    {
      source: "claude-cowork",
      root: join(home, "Library", "Application Support", "Claude", "local-agent-mode-sessions"),
    },
  ];
}

export async function discoverTranscriptFiles(
  roots: SourceRoot[] = defaultSourceRoots(),
  onError?: DiscoveryErrorHandler,
): Promise<TranscriptFile[]> {
  const files: TranscriptFile[] = [];
  for (const sourceRoot of roots) {
    await walk(sourceRoot, sourceRoot.root, files, onError);
  }
  const unique = new Map(files.map((file) => [`${file.source}\0${file.path}`, file]));
  return [...unique.values()].sort((left, right) => left.path.localeCompare(right.path));
}

async function walk(
  sourceRoot: SourceRoot,
  directory: string,
  files: TranscriptFile[],
  onError?: DiscoveryErrorHandler,
): Promise<void> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    if (!onError) throw error;
    onError(sourceRoot.source, directory, error);
    return;
  }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && !IGNORED_TRANSCRIPT_DIRECTORIES.has(entry.name)) {
      await walk(sourceRoot, path, files, onError);
    } else if (entry.isFile() && isTranscriptFile(sourceRoot.source, path, entry.name)) {
      try {
        const info = await stat(path);
        files.push({ source: sourceRoot.source, path, size: info.size, mtimeMs: info.mtimeMs });
      } catch (error) {
        if (!onError) throw error;
        onError(sourceRoot.source, path, error);
      }
    }
  }
}

const IGNORED_TRANSCRIPT_DIRECTORIES = new Set(["subagents", "outputs", "uploads"]);

function isTranscriptFile(source: AgentSource, path: string, name: string): boolean {
  if (!name.endsWith(".jsonl") || name === "audit.jsonl") return false;
  if (source !== "claude-cowork") return true;
  return path.includes(`${sep}.claude${sep}projects${sep}`);
}

export async function captureTranscript(file: TranscriptFile): Promise<CapturedConversation> {
  const before = await stat(file.path);
  const content = await readFile(file.path, "utf8");
  const after = await stat(file.path);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
    throw new Error("Transcript changed while it was being read; it will be retried");
  }
  const currentFile = { ...file, size: after.size, mtimeMs: after.mtimeMs };
  const parsed = parseTranscript(file.source, content, after.mtimeMs);
  const record = conversationRecord(parsed);
  return {
    file: currentFile,
    fileHash: sha256(content),
    record,
  };
}

export function parseTranscript(
  source: AgentSource,
  content: string,
  fallbackMtimeMs: number,
): ParsedConversation {
  const { records, incomplete } = jsonLines(content);
  const state: {
    sessionId?: string;
    cwd?: string;
    model?: string;
    timestamps: string[];
    messages: AgentMessage[];
  } = { timestamps: [], messages: [] };

  for (const record of records) {
    if (source === "codex") readCodex(record, state);
    else readClaude(record, state);
  }
  if (!state.sessionId) throw new Error("Transcript has no native session ID");
  if (state.messages.length === 0) throw new Error("Transcript has no visible conversation messages");
  const fallback = new Date(fallbackMtimeMs).toISOString();
  const timestamps = state.timestamps.sort();
  return {
    source,
    sessionId: state.sessionId,
    cwd: state.cwd,
    model: state.model,
    createdAt: timestamps[0] ?? fallback,
    updatedAt: timestamps.at(-1) ?? fallback,
    messages: conversationMessages(state.messages),
    incomplete,
  };
}

type ParserState = {
  sessionId?: string;
  cwd?: string;
  model?: string;
  timestamps: string[];
  messages: AgentMessage[];
};

function readCodex(record: Record<string, unknown>, state: ParserState): void {
  const type = stringValue(record.type);
  const payload = objectValue(record.payload);
  rememberTimestamp(record.timestamp, state);
  if (type === "session_meta" && payload) {
    assignString(state, "sessionId", payload.id);
    assignString(state, "cwd", payload.cwd);
    rememberTimestamp(payload.timestamp, state);
    return;
  }
  if (type === "turn_context" && payload) {
    assignString(state, "cwd", payload.cwd);
    assignString(state, "model", payload.model);
    return;
  }
  if (type === "event_msg" && payload) {
    const payloadType = stringValue(payload.type);
    const phase = stringValue(payload.phase);
    if (payloadType === "user_message" || (payloadType === "agent_message" && phase === "final_answer")) {
      const text = stringValue(payload.message) ?? stringValue(payload.text);
      if (text && !isInjectedUserContext(payloadType, text)) {
        state.messages.push({
          role: payloadType === "user_message" ? "user" : "assistant",
          text,
          createdAt: isoValue(record.timestamp),
        });
      }
    }
    return;
  }
  if (type !== "response_item" || !payload) return;
  const payloadType = stringValue(payload.type);
  if (payloadType === "message") {
    const role = stringValue(payload.role);
    if (role !== "user" && role !== "assistant") return;
    const phase = stringValue(payload.phase);
    if (role === "assistant" && phase !== "final_answer") return;
    const text = textParts(payload.content).join("\n\n");
    if (text && !isInjectedUserContext(role === "user" ? "user_message" : "agent_message", text)) {
      state.messages.push({ role, text, createdAt: isoValue(record.timestamp) });
    }
  }
}

function readClaude(record: Record<string, unknown>, state: ParserState): void {
  const sessionId = stringValue(record.sessionId) ?? stringValue(record.session_id);
  if (sessionId) state.sessionId = sessionId;
  assignString(state, "cwd", record.cwd);
  rememberTimestamp(record.timestamp, state);
  const type = stringValue(record.type);
  if (type !== "user" && type !== "assistant") return;
  const message = objectValue(record.message);
  const role = stringValue(message?.role);
  if (role !== "user" && role !== "assistant") return;
  assignString(state, "model", message?.model);
  const createdAt = isoValue(record.timestamp);
  const content = message?.content;
  if (typeof content === "string") {
    state.messages.push({ role, text: content, createdAt });
    return;
  }
  if (!Array.isArray(content)) return;
  const texts: string[] = [];
  for (const rawBlock of content) {
    const block = objectValue(rawBlock);
    const blockType = stringValue(block?.type);
    if (!block || blockType === "thinking" || blockType === "tool_use" || blockType === "tool_result") continue;
    else {
      const text = stringValue(block.text);
      if (text) texts.push(text);
    }
  }
  if (texts.length > 0) state.messages.push({ role, text: texts.join("\n\n"), createdAt });
}

function assignString(state: ParserState, key: "sessionId" | "cwd" | "model", value: unknown): void {
  const parsed = stringValue(value);
  if (parsed) state[key] = parsed;
}

export function conversationRecord(conversation: ParsedConversation): AgentConversationRecord {
  const body = truncateConversationBody(renderConversation(conversation));
  return AgentConversationRecordSchema.parse({
    id: `ac1_${sha256(`${conversation.source}\0${conversation.sessionId}`, "base64url")}`,
    created_at: conversation.createdAt,
    updated_at: conversation.updatedAt,
    participants: [],
    body,
  });
}

function renderConversation(conversation: ParsedConversation): string {
  const firstUser = conversation.messages.find((message) => message.role === "user")?.text;
  const title = firstUser?.split(/\r?\n/, 1)[0]?.trim().slice(0, 100);
  const lines = [
    `# Agent conversation${title ? `: ${title}` : ""}`,
  ];
  for (const message of conversation.messages) {
    const label = message.role === "user" ? "User" : "Assistant";
    lines.push("", `### ${label}${message.createdAt ? ` — ${message.createdAt}` : ""}`, "");
    lines.push(message.text.trim());
  }
  return `${lines.join("\n").trim()}\n`;
}

function jsonLines(content: string): { records: Record<string, unknown>[]; incomplete: boolean } {
  const lines = content.split(/\r?\n/);
  const nonempty = lines.map((line, index) => ({ line: line.trim(), index })).filter(({ line }) => line);
  const records: Record<string, unknown>[] = [];
  let incomplete = false;
  for (const [position, entry] of nonempty.entries()) {
    try {
      const parsed = JSON.parse(entry.line) as unknown;
      const record = objectValue(parsed);
      if (record) records.push(record);
    } catch {
      if (position === nonempty.length - 1) {
        incomplete = true;
      } else {
        throw new Error(`Transcript contains invalid JSONL at line ${entry.index + 1}`);
      }
    }
  }
  return { records, incomplete };
}

function textParts(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value] : [];
  if (!Array.isArray(value)) return [];
  return value.flatMap((part) => {
    const block = objectValue(part);
    const type = stringValue(block?.type);
    if (type === "input_text" || type === "output_text" || type === "text" || !type) {
      const text = stringValue(block?.text);
      return text ? [text] : [];
    }
    return [];
  });
}

function conversationMessages(messages: AgentMessage[]): AgentMessage[] {
  const result: AgentMessage[] = [];
  for (const message of messages) {
    if (message.role === "tool") continue;
    const previous = result.at(-1);
    if (previous && sameMessage(previous, message) && timestampsNear(previous.createdAt, message.createdAt)) continue;
    // Claude transcripts do not label commentary versus final answers. Within a
    // user turn, its last visible assistant message is the final response.
    if (message.role === "assistant" && previous?.role === "assistant") result[result.length - 1] = message;
    else result.push(message);
  }
  return result;
}

function isInjectedUserContext(payloadType: string, text: string): boolean {
  if (payloadType !== "user_message") return false;
  const trimmed = text.trim();
  return /^<(recommended_plugins|environment_context)>[\s\S]*<\/\1>$/.test(trimmed);
}

function sameMessage(left: AgentMessage, right: AgentMessage): boolean {
  return left.role === right.role && left.toolName === right.toolName && left.text === right.text;
}

function timestampsNear(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) return left === right;
  return Math.abs(Date.parse(left) - Date.parse(right)) <= 2_000;
}

function rememberTimestamp(value: unknown, state: ParserState): void {
  const timestamp = isoValue(value);
  if (timestamp) state.timestamps.push(timestamp);
}

function isoValue(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function truncateConversationBody(body: string): string {
  if (Buffer.byteLength(body, "utf8") <= MAX_BODY_BYTES) return body;
  const marker = "\n\n> Context Use truncated the middle of this large conversation during ingestion.\n\n";
  // Leave a few bytes for replacement characters if either byte slice lands
  // in the middle of a multi-byte code point.
  const budget = MAX_BODY_BYTES - Buffer.byteLength(marker, "utf8") - 8;
  const bytes = Buffer.from(body, "utf8");
  const head = utf8Slice(bytes, 0, Math.floor(budget / 2));
  const tail = utf8Slice(bytes, bytes.length - Math.ceil(budget / 2), bytes.length);
  return `${head}${marker}${tail}`;
}

function utf8Slice(bytes: Buffer, start: number, end: number): string {
  return new TextDecoder().decode(bytes.subarray(Math.max(0, start), Math.min(bytes.length, end)));
}

function sha256(value: string, encoding: "hex" | "base64url" = "hex"): string {
  return createHash("sha256").update(value).digest(encoding);
}
