/** biome-ignore-all lint/complexity/useMaxParams: Host hook callbacks use positional arguments. */
import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  OpenClawPluginApi,
  OpenClawPluginService,
  PluginRuntime,
} from 'openclaw/plugin-sdk/core';
import { callMemoryTool } from '../src/client';
import { FINISH_LEARNING_TOOL } from '../src/contract';
import { registerLearning } from '../src/learning';
import { LearningStore } from '../src/learning-store';
import { writeState } from '../src/state';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});
const CONNECTION_ID = '00000000-0000-4000-8000-000000000001';
const config = { agentId: 'main', serverUrl: 'https://memory.example/mcp' };
const context = {
  agentId: 'main',
  sessionKey: 'agent:main:telegram:group:123:topic:1',
  sessionId: 'session-1',
};
const messages = [
  { role: 'user', content: 'Liza is arriving tonight. I will pick her up at Stansted.' },
];

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'learning-hooks-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const state = {
    learningId: CONNECTION_ID,
    config,
    changes: [],
    tools: [],
    oauth: {
      client: { client_id: 'owner' },
      tokens: { access_token: 'test', token_type: 'Bearer' },
    },
  };
  await writeState({ directory, state });
  const hooks = new Map<string, unknown>();
  let service: OpenClawPluginService;
  let factory: (context: unknown) => { execute: () => Promise<unknown> } | null;
  const dispatched: Parameters<PluginRuntime['subagent']['run']>[0][] = [];
  const deleted: string[] = [];
  const warnings: string[] = [];
  let acknowledged = false;
  const api = {
    on: (name: string, handler: unknown) => hooks.set(name, handler),
    registerTool: (value: typeof factory) => {
      factory = value;
    },
    registerService: (value: OpenClawPluginService) => {
      service = value;
    },
    lifecycle: { registerRuntimeLifecycle: () => {} },
    logger: { warn: (warning: string) => warnings.push(warning) },
    runtime: {
      subagent: {
        run: (params: Parameters<PluginRuntime['subagent']['run']>[0]) => {
          dispatched.push(params);
          return Promise.resolve({ runId: 'run-1' });
        },
        waitForRun: () => Promise.resolve({ status: 'ok' }),
        getSessionMessages: () => Promise.resolve({ messages }),
        deleteSession: (params: { sessionKey: string }) => {
          deleted.push(params.sessionKey);
          return Promise.resolve();
        },
      },
    },
  } as unknown as OpenClawPluginApi;
  registerLearning({
    api,
    directory,
    config,
    connectionId: CONNECTION_ID,
    toolNames: ['context_use_create_knowledge_page', 'context_use_archive_entity'],
  });
  const db = new LearningStore({ directory, config, connectionId: CONNECTION_ID });
  cleanups.push(() => {
    db.close();
    return Promise.resolve();
  });
  const serviceContext = { config: {}, stateDir: directory, logger: api.logger };
  cleanups.push(async () => {
    await service.stop?.(serviceContext);
  });
  const hook = (name: string, event: unknown, ctx: unknown = context) =>
    (hooks.get(name) as (event: unknown, ctx: unknown) => unknown)(event, ctx);
  const cycle = async () => {
    await service.start(serviceContext);
    // stop waits for the outstanding tick, proving shutdown leaves no in-process work.
    await service.stop?.(serviceContext);
  };
  const acknowledge = async () => {
    const sessionKey = db.current()!.sessionKey;
    await factory({ agentId: 'main', sessionKey })!.execute();
    acknowledged = true;
  };
  return {
    db,
    state,
    directory,
    hook,
    cycle,
    acknowledge,
    dispatched,
    deleted,
    warnings,
    get acknowledged() {
      return acknowledged;
    },
  };
}

test('turn and reset hooks capture synchronously without invoking a model, then a silent worker learns', async () => {
  const f = await fixture();
  expect(f.hook('agent_end', { messages, success: true })).toBeUndefined();
  f.hook('before_reset', { messages, reason: 'new' });
  expect(f.dispatched).toHaveLength(0);
  expect(f.db.status().pending).toBe(1);
  await f.cycle();
  expect(f.dispatched).toHaveLength(1);
  expect(f.dispatched[0]?.deliver).toBe(false);
  expect(f.dispatched[0]?.message).toContain('Stansted');
  expect(f.dispatched[0]?.toolsAlsoAllow).toContain(FINISH_LEARNING_TOOL);
  expect(f.dispatched[0]?.toolsAlsoAllow).not.toContain('context_use_archive_entity');
  await f.acknowledge();
  await f.cycle();
  expect(f.db.status().pending).toBe(0);
  expect(f.deleted).toHaveLength(1);
  expect(f.warnings).toEqual([]);
});

test('compaction captures the host transcript when the hook omits messages', async () => {
  const f = await fixture();
  await f.hook('before_compaction', { messageCount: 1 });
  expect(f.db.status().pending).toBe(1);
  expect(f.dispatched).toHaveLength(0);
});

test('workers cannot recurse, cross agents, perform external actions, or run after account changes', async () => {
  const f = await fixture();
  f.hook('agent_end', { messages }, { ...context, agentId: 'other' });
  f.hook(
    'agent_end',
    { messages },
    { ...context, sessionKey: 'agent:main:main:active-memory:test' },
  );
  f.hook(
    'agent_end',
    { messages },
    { ...context, sessionKey: 'agent:main:context-use-learning:fake' },
  );
  expect(f.db.status().pending).toBe(0);
  f.hook('before_reset', { messages });
  await f.cycle();
  const worker = { agentId: 'main', sessionKey: f.db.current()!.sessionKey };
  for (const toolName of ['exec', 'message', 'sessions_spawn', 'context_use_archive_entity']) {
    expect(f.hook('before_tool_call', { toolName }, worker)).toMatchObject({ block: true });
  }
  expect(
    f.hook('before_tool_call', { toolName: 'context_use_create_knowledge_page' }, worker),
  ).toBeUndefined();
  f.state.learningId = '00000000-0000-4000-8000-000000000002';
  await writeState({ directory: f.directory, state: f.state });
  expect(
    f.hook('before_tool_call', { toolName: 'context_use_create_knowledge_page' }, worker),
  ).toMatchObject({ block: true });
  await expect(
    callMemoryTool({
      directory: f.directory,
      connectionId: CONNECTION_ID,
      ...config,
      name: 'list_entities',
      arguments: {},
    }),
  ).rejects.toThrow('disconnected');
});

test('a model that finishes without acknowledging does not discard evidence', async () => {
  const f = await fixture();
  f.hook('agent_end', { messages });
  await f.cycle();
  await f.cycle();
  expect(f.db.status().pending).toBe(1);
  expect(f.db.status().retryAt).toBeGreaterThan(Date.now());
  expect(f.warnings).toHaveLength(1);
});
