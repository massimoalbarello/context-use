import { isDeepStrictEqual } from 'node:util';
import type { OpenClawConfig } from 'openclaw/plugin-sdk/config-runtime';
import { PLUGIN_ID, type PluginConfig, toolName } from './contract';
import { ConnectionError } from './error';
import { RECALL_GUIDANCE } from './guidance';
import type { ConnectionState } from './state';

type ConfigObject = Record<string, unknown>;
function object(value: unknown): ConfigObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as ConfigObject;
}

export function readPath(input: { config: OpenClawConfig; path: string[] }): unknown {
  let value: unknown = input.config;
  for (const key of input.path) {
    value = object(value)[key];
  }
  return value;
}

function writePath(input: { config: OpenClawConfig; path: string[]; value: unknown }): void {
  const [key, ...rest] = input.path;
  if (!key || ['__proto__', 'prototype', 'constructor'].includes(key)) {
    throw new ConnectionError('Invalid configuration path.');
  }
  const target = input.config as ConfigObject;
  if (rest.length === 0) {
    if (input.value === undefined) {
      delete target[key];
    } else {
      target[key] = input.value;
    }
    return;
  }
  target[key] = object(target[key]);
  writePath({ config: target[key] as OpenClawConfig, path: rest, value: input.value });
  if (Object.keys(object(target[key])).length === 0) {
    delete target[key];
  }
}

export function configurationPlan(state: ConnectionState): { path: string[]; value: unknown }[] {
  const agent = ['agents', 'entries', state.config.agentId];
  const plugin = ['plugins', 'entries', PLUGIN_ID];
  const active = ['plugins', 'entries', 'active-memory'];
  return [
    { path: [...plugin, 'config'], value: state.config },
    { path: [...plugin, 'enabled'], value: true },
    { path: [...plugin, 'hooks', 'allowConversationAccess'], value: true },
    { path: [...plugin, 'hooks', 'allowPromptInjection'], value: true },
    { path: ['plugins', 'slots', 'memory'], value: PLUGIN_ID },
    { path: ['plugins', 'entries', 'memory-core', 'enabled'], value: false },
    { path: [...agent, 'memory', 'search', 'rememberAcrossConversations'], value: false },
    { path: ['hooks', 'internal', 'enabled'], value: true },
    { path: ['hooks', 'internal', 'entries', 'session-memory', 'enabled'], value: false },
    { path: [...active, 'enabled'], value: true },
    { path: [...active, 'config', 'enabled'], value: true },
    { path: [...active, 'config', 'agents'], value: [state.config.agentId] },
    { path: [...active, 'config', 'mode'], value: 'always' },
    { path: [...active, 'config', 'allowedChatTypes'], value: ['direct', 'explicit'] },
    { path: [...active, 'config', 'queryMode'], value: 'recent' },
    {
      path: [...active, 'config', 'toolsAllow'],
      value: state.tools
        .filter(
          (tool) =>
            tool.annotations?.readOnlyHint === true &&
            tool.name !== 'read_hypermedia_curation_guide',
        )
        .map((tool) => toolName(tool.name)),
    },
    {
      path: [...active, 'config', 'promptAppend'],
      value: `${RECALL_GUIDANCE} Return only useful grounded context, or NONE when nothing helps.`,
    },
    { path: [...active, 'config', 'timeoutMs'], value: 30_000 },
    { path: [...active, 'config', 'maxSummaryChars'], value: 1_000 },
    { path: [...active, 'config', 'persistTranscripts'], value: false },
  ];
}

export function prepareConfiguration(input: {
  config: OpenClawConfig;
  state: ConnectionState;
}): void {
  const config = input.config;
  assertPersonalConfiguration(input);
  const grants = ['agents', 'entries', input.state.config.agentId, 'tools', 'alsoAllow'];
  const allow = ['agents', 'entries', input.state.config.agentId, 'tools', 'allow'];
  const grantPath = readPath({ config, path: allow }) === undefined ? grants : allow;
  const alsoAllow = readPath({ config, path: grantPath });
  const pluginAllow = config.plugins?.allow;
  const plan = configurationPlan(input.state);
  plan.push({
    path: grantPath,
    value: [...new Set([...(Array.isArray(alsoAllow) ? alsoAllow : []), PLUGIN_ID])],
  });
  if (pluginAllow) {
    plan.push({
      path: ['plugins', 'allow'],
      value: [...new Set([...pluginAllow, PLUGIN_ID, 'active-memory'])],
    });
  }
  applyPlan({ ...input, plan });
}

function applyPlan(input: {
  config: OpenClawConfig;
  state: ConnectionState;
  plan: { path: string[]; value: unknown }[];
}): void {
  const config = input.config;
  for (const { path, value } of input.plan) {
    const before = readPath({ config, path });
    const existing = input.state.changes.find((change) => isDeepStrictEqual(change.path, path));
    if (
      existing &&
      !isDeepStrictEqual(before, existing.applied) &&
      !isDeepStrictEqual(before, existing.before)
    ) {
      throw new ConnectionError(
        `Configuration changed since setup: ${path.join('.')}. Disconnect before reconfiguring.`,
      );
    }
    if (!existing) {
      input.state.changes.push({ path, before, applied: value });
    } else {
      existing.applied = value;
    }
    writePath({ config, path, value });
  }
}

export function restoreConfiguration(input: {
  config: OpenClawConfig;
  state: ConnectionState;
}): string[] {
  const permitted = configurationPlan(input.state).map((entry) => entry.path);
  permitted.push(
    ['agents', 'entries', input.state.config.agentId, 'tools', 'alsoAllow'],
    ['agents', 'entries', input.state.config.agentId, 'tools', 'allow'],
    ['plugins', 'allow'],
  );
  const preserved: string[] = [];
  for (const change of [...input.state.changes].reverse()) {
    if (!permitted.some((path) => isDeepStrictEqual(path, change.path))) {
      throw new ConnectionError('Invalid setup restoration record.');
    }
    const current = readPath({ config: input.config, path: change.path });
    if (isDeepStrictEqual(current, change.applied)) {
      writePath({ config: input.config, path: change.path, value: change.before });
    } else if (!isDeepStrictEqual(current, change.before)) {
      preserved.push(change.path.join('.'));
    }
  }
  return preserved;
}

export function configMatches(input: { actual: unknown; expected: PluginConfig }): boolean {
  return isDeepStrictEqual(input.actual, input.expected);
}

export function assertPersonalConfiguration(input: {
  config: OpenClawConfig;
  state: ConnectionState;
}): void {
  const config = input.config;
  if (
    config.plugins?.enabled === false ||
    config.plugins?.deny?.some((id) => id === PLUGIN_ID || id === 'active-memory')
  ) {
    throw new ConnectionError('Context Use is disabled by OpenClaw plugin policy.');
  }
  if (config.agents?.entries && !config.agents.entries[input.state.config.agentId]) {
    throw new ConnectionError(`Agent ${input.state.config.agentId} does not exist.`);
  }
  if (Object.keys(config.agents?.entries ?? {}).length > 1) {
    throw new ConnectionError(
      'This version supports one personal agent per OpenClaw installation.',
    );
  }
  const scope = config.session?.dmScope;
  if (scope && scope !== 'main') {
    throw new ConnectionError(
      'This version requires a personal OpenClaw installation with main DM scope.',
    );
  }
}
