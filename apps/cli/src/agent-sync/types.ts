import type { AgentConversationRecord } from "./record.ts";

export const AGENT_SOURCES = ["codex", "claude-code", "claude-cowork"] as const;
export type AgentSource = (typeof AGENT_SOURCES)[number];

export type SourceRoot = {
  source: AgentSource;
  root: string;
};

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
  record: AgentConversationRecord;
};

type AgentSyncConfigBase = {
  deploymentId: string;
  connectionId: string;
  webhookUrl: string;
  installedAt: string;
  label: string;
};

export type LegacyAgentSyncConfig = AgentSyncConfigBase & {
  schemaVersion: 1;
};

export type InstanceAgentSyncConfig = AgentSyncConfigBase & {
  schemaVersion: 2;
  instanceId: string;
};

export type AgentSyncConfig = LegacyAgentSyncConfig | InstanceAgentSyncConfig;
