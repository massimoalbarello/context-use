import { describe, expect, test } from 'bun:test';
import type { OpenClawConfig } from 'openclaw/plugin-sdk/config-runtime';
import { prepareConfiguration, restoreConfiguration } from '../src/configuration';
import type { ConnectionState } from '../src/state';

function connection(): ConnectionState {
  return {
    config: { agentId: 'main', serverUrl: 'https://memory.example/mcp' },
    changes: [],
    oauth: {},
    tools: [
      {
        name: 'search_hypermedia',
        inputSchema: { type: 'object' },
        annotations: { readOnlyHint: true },
      },
      { name: 'create_knowledge_page', inputSchema: { type: 'object' } },
    ],
  };
}

describe('exclusive memory configuration', () => {
  const editedTimeoutMs = 45_000;
  test('changing servers retains the original restoration values', () => {
    const original: OpenClawConfig = { plugins: { slots: { memory: 'memory-core' } } };
    const config = structuredClone(original);
    const state = connection();
    prepareConfiguration({ config, state });
    state.config = { ...state.config, serverUrl: 'https://another.example/mcp' };
    prepareConfiguration({ config, state });
    expect(config.plugins?.entries?.['context-use']?.config?.serverUrl).toBe(
      'https://another.example/mcp',
    );
    expect(restoreConfiguration({ config, state })).toEqual([]);
    expect(config).toEqual(original);
  });
  test('reauthorization preserves later edits without claiming ownership of their grants', () => {
    const config: OpenClawConfig = {
      plugins: { allow: ['memory-core'] },
      agents: { entries: { main: { tools: { alsoAllow: ['exec'] } } } },
    };
    const state = connection();
    prepareConfiguration({ config, state });
    const journal = structuredClone(state.changes);
    config.plugins!.entries!['active-memory']!.config!.timeoutMs = editedTimeoutMs;
    config.agents!.entries!.main!.tools!.alsoAllow!.push('web_search');
    config.plugins!.allow!.push('another-plugin');
    const edited = structuredClone(config);
    prepareConfiguration({ config, state });
    expect(config).toEqual(edited);
    expect(state.changes).toEqual(journal);
    restoreConfiguration({ config, state });
    expect(config.plugins!.entries!['active-memory']!.config!.timeoutMs).toBe(editedTimeoutMs);
    expect(config.agents!.entries!.main!.tools!.alsoAllow).toEqual(['exec', 'web_search']);
    expect(config.plugins!.allow).toEqual(['memory-core', 'another-plugin']);
  });

  test('switching servers updates owned tools while preserving edits and restoring replaced tools', () => {
    const config: OpenClawConfig = {
      plugins: { entries: { 'active-memory': { config: { toolsAllow: ['original_tool'] } } } },
    };
    const state = connection();
    prepareConfiguration({ config, state });
    const active = config.plugins!.entries!['active-memory']!.config!;
    active.timeoutMs = editedTimeoutMs;
    (active.toolsAllow as string[]).push('user_tool');
    state.config = { ...state.config, serverUrl: 'https://another.example/mcp' };
    state.tools = [
      {
        name: 'read_knowledge_page',
        inputSchema: { type: 'object' },
        annotations: { readOnlyHint: true },
      },
    ];
    prepareConfiguration({ config, state });
    expect(active.toolsAllow).toEqual(['user_tool', 'context_use_read_knowledge_page']);
    expect(active.timeoutMs).toBe(editedTimeoutMs);
    restoreConfiguration({ config, state });
    expect(active.toolsAllow).toEqual(['user_tool', 'original_tool']);
    expect(active.timeoutMs).toBe(editedTimeoutMs);
  });

  test('reauthorization preserves settings the user restored to their original values', () => {
    const config: OpenClawConfig = {
      plugins: { entries: { 'active-memory': { config: { timeoutMs: editedTimeoutMs } } } },
    };
    const state = connection();
    prepareConfiguration({ config, state });
    config.plugins!.entries!['active-memory']!.config!.timeoutMs = editedTimeoutMs;
    const edited = structuredClone(config);
    prepareConfiguration({ config, state });
    expect(config).toEqual(edited);
    restoreConfiguration({ config, state });
    expect(config.plugins!.entries!['active-memory']!.config!.timeoutMs).toBe(editedTimeoutMs);
  });

  test('retries a journal written before its configuration commit', () => {
    const original: OpenClawConfig = { plugins: { slots: { memory: 'memory-core' } } };
    const state = connection();
    const attempted = structuredClone(original);
    prepareConfiguration({ config: attempted, state });
    const retry = structuredClone(original);
    prepareConfiguration({ config: retry, state });
    expect(retry).toEqual(attempted);
    restoreConfiguration({ config: retry, state });
    expect(retry).toEqual(original);
  });

  test('connect preserves separate conversations and disconnect restores the original values', () => {
    const original: OpenClawConfig = {
      session: { dmScope: 'per-channel-peer' },
      plugins: { slots: { memory: 'memory-core' }, allow: ['memory-core'] },
      agents: { entries: { main: { tools: { allow: ['read'] } } } },
    };
    const config = structuredClone(original);
    const state = connection();
    prepareConfiguration({ config, state });
    const connected = structuredClone(config);
    prepareConfiguration({ config, state });
    expect(config).toEqual(connected);
    expect(config.plugins?.slots?.memory).toBe('context-use');
    expect(config.session?.dmScope).toBe('per-channel-peer');
    expect(config.agents?.entries?.main?.tools?.allow).toEqual(['read', 'context-use']);
    expect(config.plugins?.entries?.['active-memory']?.config?.toolsAllow).toEqual([
      'context_use_search_hypermedia',
    ]);
    expect(restoreConfiguration({ config, state })).toEqual([]);
    expect(config).toEqual(original);
  });

  test('removal preserves subsequent edits and does not touch remote data', () => {
    const config: OpenClawConfig = {};
    const state = connection();
    const userTimeout = editedTimeoutMs;
    prepareConfiguration({ config, state });
    config.plugins!.entries!['active-memory']!.config!.timeoutMs = userTimeout;
    config.agents!.defaults = { workspace: '/custom/work' };
    expect(restoreConfiguration({ config, state })).toEqual([
      'plugins.entries.active-memory.config.timeoutMs',
    ]);
    expect(config).toEqual({
      plugins: { entries: { 'active-memory': { config: { timeoutMs: 45_000 } } } },
      agents: { defaults: { workspace: '/custom/work' } },
    });
  });

  test('setup enables recall across chat types and remains reversible', () => {
    const original: OpenClawConfig = { tools: { profile: 'coding' } };
    const config = structuredClone(original);
    const state = connection();
    prepareConfiguration({ config, state });
    expect(config.plugins?.entries?.['active-memory']?.config?.allowedChatTypes).toEqual([
      'direct',
      'explicit',
      'group',
      'channel',
    ]);
    expect(config.tools?.profile).toBe('coding');
    expect(restoreConfiguration({ config, state })).toEqual([]);
    expect(config).toEqual(original);
  });

  test('rejects denied plugins and a forged restoration path', () => {
    const state = connection();
    expect(() =>
      prepareConfiguration({ config: { plugins: { deny: ['context-use'] } }, state }),
    ).toThrow();
    state.changes = [{ path: ['env'], before: {}, applied: {} }];
    expect(() => restoreConfiguration({ config: {}, state })).toThrow(
      'Invalid setup restoration record',
    );
  });

  test('removes setup-owned grants while preserving later additions', () => {
    const config: OpenClawConfig = {
      plugins: { allow: ['memory-core'] },
      agents: { entries: { main: { tools: { alsoAllow: ['exec'] } } } },
    };
    const state = connection();
    prepareConfiguration({ config, state });
    config.agents!.entries!.main!.tools!.alsoAllow!.push('web_search');
    config.plugins!.allow!.push('another-plugin');
    (config.plugins!.entries!['active-memory']!.config!.toolsAllow as string[]).push(
      'another_tool',
    );
    restoreConfiguration({ config, state });
    expect(config.plugins?.allow).toEqual(['memory-core', 'another-plugin']);
    expect(config.plugins?.entries?.['active-memory']?.config?.toolsAllow).toEqual([
      'another_tool',
    ]);
    expect(config.agents?.entries?.main?.tools?.alsoAllow).toEqual(['exec', 'web_search']);
  });
});
