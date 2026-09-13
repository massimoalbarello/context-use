import { expect, test } from 'bun:test';
import { canUseMemory, filterBootstrap, isMemoryPath, memoryCapability } from '../src/lifecycle';

test('excludes competing bootstrap memory while retaining operational instructions', () => {
  const files = ['AGENTS.md', 'SOUL.md', 'USER.md', 'MEMORY.md', 'memory/2026-09-13.md'].map(
    (name) => ({ name, path: `/work/${name}`, missing: false, content: 'fixture' }),
  );
  filterBootstrap({ files, workspaceDir: '/work' });
  expect(files.map((file) => file.name)).toEqual(['AGENTS.md', 'SOUL.md']);
  expect(isMemoryPath({ path: '/work/src/memory/index.ts', workspaceDir: '/work' })).toBe(false);
});

test('remote flush never tells the agent to write a local memory file', () => {
  const capability = memoryCapability('main');
  expect(capability.supportsPrivateTranscriptRecall).toBe(false);
  const prompt = capability.promptBuilder!({
    agentId: 'main',
    availableTools: new Set(),
    sandboxed: false,
  }).join('\n');
  expect(prompt).toContain('sole durable personal memory');
  expect(prompt).toContain('including background');
  const plan = capability.flushPlanResolver!({
    cfg: {},
    nowMs: Date.now(),
    contextWindowTokens: 100_000,
  });
  expect(plan?.prompt).toContain('context_use_read_hypermedia_curation_guide');
  expect(plan?.relativePath).toBe('context-use-remote-memory');
});

test('personal memory allows owner and background runs but excludes other senders and agents', () => {
  const context = { agentId: 'main', sessionKey: 'agent:main:main' };
  expect(canUseMemory({ agentId: 'main', context })).toBe(true);
  expect(canUseMemory({ agentId: 'main', context: { ...context, senderIsOwner: false } })).toBe(
    true,
  );
  expect(
    canUseMemory({
      agentId: 'main',
      context: { ...context, requesterSenderId: 'owner', senderIsOwner: true },
    }),
  ).toBe(true);
  expect(
    canUseMemory({ agentId: 'main', context: { ...context, requesterSenderId: 'visitor' } }),
  ).toBe(false);
  expect(
    canUseMemory({
      agentId: 'main',
      context: { ...context, sessionKey: 'agent:main:telegram:group:123' },
    }),
  ).toBe(false);
  expect(canUseMemory({ agentId: 'other', context })).toBe(false);
});
