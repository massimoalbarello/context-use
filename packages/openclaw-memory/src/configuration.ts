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
    {
      path: [...active, 'config', 'allowedChatTypes'],
      value: ['direct', 'explicit', 'group', 'channel'],
    },
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
  const previousGrant = input.state.changes.find(
    (change) => isDeepStrictEqual(change.path, grants) || isDeepStrictEqual(change.path, allow),
  );
  const grantPath =
    previousGrant?.path ?? (readPath({ config, path: allow }) === undefined ? grants : allow);
  const alsoAllow = previousGrant?.applied ?? readPath({ config, path: grantPath });
  const pluginAllow =
    input.state.changes.find((change) => isDeepStrictEqual(change.path, ['plugins', 'allow']))
      ?.applied ?? config.plugins?.allow;
  const plan = configurationPlan(input.state);
  plan.push({
    path: grantPath,
    value: [...new Set([...(Array.isArray(alsoAllow) ? alsoAllow : []), PLUGIN_ID])],
  });
  if (Array.isArray(pluginAllow)) {
    plan.push({
      path: ['plugins', 'allow'],
      value: [...new Set([...pluginAllow, PLUGIN_ID, 'active-memory'])],
    });
  }
  const previousConnection = input.state.changes.find((change) =>
    isDeepStrictEqual(change.path, ['plugins', 'entries', PLUGIN_ID, 'config']),
  );
  // The connection config is committed atomically with the initial settings. Its presence
  // distinguishes reauthorization from retrying a journal whose config write never committed.
  const reconfiguring = Boolean(
    previousConnection &&
      isDeepStrictEqual(
        readPath({ config, path: previousConnection.path }),
        previousConnection.applied,
      ),
  );
  applyPlan({ ...input, plan, reconfiguring });
}

function mergeListChange(input: { current: unknown[]; from: unknown[]; to: unknown[] }): unknown[] {
  const removed = input.from.filter((value) => !input.to.includes(value));
  const added = input.to.filter((value) => !input.from.includes(value));
  return [...new Set([...input.current.filter((value) => !removed.includes(value)), ...added])];
}

function applyPlan(input: {
  config: OpenClawConfig;
  state: ConnectionState;
  plan: { path: string[]; value: unknown }[];
  reconfiguring: boolean;
}): void {
  const config = input.config;
  for (const { path, value } of input.plan) {
    const before = readPath({ config, path });
    const existing = input.state.changes.find((change) => isDeepStrictEqual(change.path, path));
    // Reauthorization owns changed connection values, not later edits to unchanged settings.
    // A journal written before a failed config commit can still apply its original plan.
    if (
      existing &&
      isDeepStrictEqual(value, existing.applied) &&
      (input.reconfiguring || !isDeepStrictEqual(before, existing.before))
    ) {
      continue;
    }
    let updated = value;
    if (
      existing &&
      !isDeepStrictEqual(before, existing.applied) &&
      !isDeepStrictEqual(before, existing.before)
    ) {
      if (Array.isArray(before) && Array.isArray(existing.applied) && Array.isArray(value)) {
        updated = mergeListChange({ current: before, from: existing.applied, to: value });
      } else {
        throw new ConnectionError(
          `Configuration changed since setup: ${path.join('.')}. Disconnect before reconfiguring.`,
        );
      }
    }
    if (!existing) {
      input.state.changes.push({
        path,
        before: structuredClone(before),
        applied: structuredClone(value),
      });
    } else {
      existing.applied = structuredClone(value);
    }
    writePath({ config, path, value: updated });
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
    } else if (
      Array.isArray(current) &&
      Array.isArray(change.applied) &&
      (change.before === undefined || Array.isArray(change.before)) &&
      ['allow', 'alsoAllow', 'toolsAllow'].includes(change.path.at(-1) ?? '')
    ) {
      writePath({
        config: input.config,
        path: change.path,
        value: mergeListChange({
          current,
          from: change.applied,
          to: (change.before as unknown[] | undefined) ?? [],
        }),
      });
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
}
