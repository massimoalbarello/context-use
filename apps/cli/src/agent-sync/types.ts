import type { PipelineRecord } from "../../../../nango-integrations/pipeline-record.ts";

export const AGENT_SOURCES = ["codex", "claude-code", "claude-cowork"] as const;
export type AgentSource = (typeof AGENT_SOURCES)[number];

export type AgentMessage = {
  role: "user" | "assistant" | "tool";
  text: string;
  createdAt?: string | undefined;
  toolName?: string | undefined;
};

export type ParsedConversation = {
  source: AgentSource;
  sessionId: string;
  cwd?: string | undefined;
  model?: string | undefined;
  createdAt: string;
  updatedAt: string;
  messages: AgentMessage[];
  incomplete: boolean;
};

export type TranscriptFile = {
  source: AgentSource;
  path: string;
  size: number;
  mtimeMs: number;
};

export type CapturedConversation = {
  file: TranscriptFile;
  fileHash: string;
  record: PipelineRecord;
};

export type AgentSyncConfig = {
  schemaVersion: 1;
  deploymentId: string;
  connectionId: string;
  webhookUrl: string;
  installedAt: string;
  label: string;
};
