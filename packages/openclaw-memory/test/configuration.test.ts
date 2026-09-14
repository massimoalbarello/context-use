import { describe, expect, test } from 'bun:test';
import type { OpenClawConfig } from 'openclaw/plugin-sdk/config-runtime';
import { prepareConfiguration, removeToolGrants, restoreConfiguration } from '../src/configuration';
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
    const userTimeout = 45_000;
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

  test('removes provider grants, including later tool-name repairs, while retaining unrelated grants', () => {
    const config: OpenClawConfig = {
      plugins: { allow: ['memory-core'] },
      tools: { alsoAllow: ['context_use_search_hypermedia', 'read'] },
      agents: { entries: { main: { tools: { alsoAllow: ['exec'] } } } },
    };
    const state = connection();
    prepareConfiguration({ config, state });
    config.agents!.entries!.main!.tools!.alsoAllow = ['exec', 'context_use_*', 'web_search'];
    config.plugins!.allow!.push('another-plugin');
    restoreConfiguration({ config, state });
    removeToolGrants(config);
    expect(config.plugins?.allow).toEqual(['memory-core', 'another-plugin']);
    expect(config.agents?.entries?.main?.tools?.alsoAllow).toEqual(['exec', 'web_search']);
    expect(config.tools?.alsoAllow).toEqual(['read']);
  });
});
