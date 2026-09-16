import { basename, relative } from 'node:path';
import type { MemoryPluginCapability, OpenClawPluginToolContext } from 'openclaw/plugin-sdk/core';
import { CONVERSATION_LEARNING_GUIDANCE, MEMORY_GUIDANCE, RECALL_GUIDANCE } from './guidance';

const MEMORY_FILES = new Set(['USER.md', 'MEMORY.md', 'memory.md', 'DREAMS.md']);

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
        ? [MEMORY_GUIDANCE, RECALL_GUIDANCE, CONVERSATION_LEARNING_GUIDANCE]
        : ['Context Use personal memory is configured for another agent.'],
    // The before_compaction hook captures evidence; no foreground model flush is needed.
    flushPlanResolver: () => null,
  };
}

export function canUseMemory(input: {
  agentId: string;
  context: Partial<OpenClawPluginToolContext>;
}): boolean {
  const context = input.context;
  return (
    context.agentId === input.agentId &&
    context.sessionKey?.startsWith(`agent:${input.agentId}:`) === true
  );
}
