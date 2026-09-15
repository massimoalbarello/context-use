import { basename, relative } from 'node:path';
import type { MemoryPluginCapability, OpenClawPluginToolContext } from 'openclaw/plugin-sdk/core';
import { LEARNING_GUIDANCE, MEMORY_GUIDANCE, RECALL_GUIDANCE } from './guidance';

const MEMORY_FILES = new Set(['USER.md', 'MEMORY.md', 'memory.md', 'DREAMS.md']);
const FLUSH_SOFT_TOKENS = 4_000;
const FLUSH_TRANSCRIPT_BYTES = 2_000_000;
const FLUSH_RESERVE_TOKENS = 20_000;
const RESERVE_FRACTION = 0.2;
const THRESHOLD_FRACTION = 0.1;

export function isMemoryPath(input: { path: string; workspaceDir: string }): boolean {
  const path = relative(input.workspaceDir, input.path).replaceAll('\\', '/');
  return MEMORY_FILES.has(path) || path.startsWith('memory/');
}

export function filterBootstrap(input: {
  files: { name: string; path: string; content?: string; missing: boolean }[];
  workspaceDir: string;
}): void {
  const retained = input.files.filter(
    (file) =>
      !MEMORY_FILES.has(basename(file.name)) &&
      !isMemoryPath({ path: file.path, workspaceDir: input.workspaceDir }),
  );
  input.files.splice(0, input.files.length, ...retained);
}

export function memoryCapability(agentId: string): MemoryPluginCapability {
  return {
    supportsPrivateTranscriptRecall: false,
    promptBuilder: (context) =>
      context.agentId === agentId
        ? [MEMORY_GUIDANCE, RECALL_GUIDANCE, LEARNING_GUIDANCE]
        : ['Context Use personal memory is configured for another agent.'],
    flushPlanResolver: ({ cfg, contextWindowTokens }) => {
      if (cfg?.agents?.defaults?.compaction?.memoryFlush?.enabled === false) {
        return null;
      }
      return {
        softThresholdTokens: Math.min(
          FLUSH_SOFT_TOKENS,
          Math.floor((contextWindowTokens ?? Infinity) * THRESHOLD_FRACTION),
        ),
        forceFlushTranscriptBytes: FLUSH_TRANSCRIPT_BYTES,
        reserveTokensFloor: Math.min(
          FLUSH_RESERVE_TOKENS,
          Math.floor((contextWindowTokens ?? Infinity) * RESERVE_FRACTION),
        ),
        prompt: `${LEARNING_GUIDANCE}\nSave useful context before compaction. Reply NO_REPLY when finished.`,
        systemPrompt: MEMORY_GUIDANCE,
        relativePath: 'context-use-remote-memory',
      };
    },
  };
}

export function canUseMemory(input: {
  agentId: string;
  context: OpenClawPluginToolContext;
}): boolean {
  const context = input.context;
  return (
    context.agentId === input.agentId &&
    context.sessionKey?.startsWith(`agent:${input.agentId}:`) === true
  );
}
