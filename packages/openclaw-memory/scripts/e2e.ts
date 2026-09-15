import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ownerBrowser } from '@repo/browser-testing/owner-browser';
import metadata from '../package.json';
import { CALLBACK_URL, PLUGIN_ID } from '../src/contract';
import { OPENCLAW_INSTALL_COMMAND, openclawSetupPrompt } from '../src/setup-prompt';
import { availablePort, startApp } from './e2e-app';
import { startModel } from './e2e-model';

const USER_TIMEOUT_MS = 45_000;
const PRIVATE_MODE = 0o600;
const EXECUTABLE_MODE = 0o700;
const COMMAND_TIMEOUT_MS = 180_000;
const COMMAND_LABEL_ARGUMENTS = 3;
const root = resolve(import.meta.dir, '..');
const repo = resolve(root, '../..');
let packageSpec = `${metadata.name}@${metadata.version}`;
if (!Bun.argv.includes('--published')) {
  const artifacts = await Array.fromAsync(
    new Bun.Glob('*.tgz').scan({ cwd: join(root, 'release'), absolute: true }),
  );
  assert.equal(artifacts.length, 1, 'Build exactly one release artifact before testing');
  packageSpec = `file:${artifacts[0]!}`;
}
const directory = await mkdtemp(join(tmpdir(), 'context-use-openclaw-test-'));
const node = process.env.OPENCLAW_TEST_NODE ?? Bun.which('node');
if (!node) {
  throw new Error('Set OPENCLAW_TEST_NODE to a Node runtime supported by OpenClaw.');
}
const stateDir = join(directory, 'openclaw');
const env = {
  ...process.env,
  OPENCLAW_STATE_DIR: stateDir,
  OPENCLAW_CONFIG_PATH: join(stateDir, 'openclaw.json'),
  PATH: `${join(directory, 'bin')}:${dirname(node)}:${process.env.PATH}`,
  OPENCLAW_EXEC_SHELL_SNAPSHOT: '0',
  npm_config_cache: join(directory, 'npm-cache'),
  npm_config_registry: 'https://registry.npmjs.org',
};
const sdkConfig = import.meta.resolve('openclaw/plugin-sdk/config-mutation');
const connectionFile = join(stateDir, 'plugins', PLUGIN_ID, 'connection.json');
const gatewayPort = availablePort();

async function command(input: string[] | { args: string[]; stdin: string }): Promise<string> {
  const { args, stdin } = Array.isArray(input) ? { args: input, stdin: undefined } : input;
  const process = Bun.spawn(args, {
    cwd: directory,
    env,
    stdin: stdin === undefined ? 'ignore' : new Blob([stdin]),
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: COMMAND_TIMEOUT_MS,
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (code !== 0 || process.signalCode || stderr.includes('context-use failed during register')) {
    throw new Error(
      `Command ${args.slice(0, COMMAND_LABEL_ARGUMENTS).join(' ')} failed (${code}): ${stderr}`,
    );
  }
  return stdout;
}
async function configure(source: string): Promise<void> {
  await command([
    node!,
    '--input-type=module',
    '-e',
    `import {mutateConfigFile} from ${JSON.stringify(sdkConfig)}; await mutateConfigFile({mutate(config){${source}}});`,
  ]);
}
async function configuration() {
  return JSON.parse(
    await command([
      node!,
      '--input-type=module',
      '-e',
      `import {readConfigFileSnapshotForWrite} from ${JSON.stringify(sdkConfig)};const {snapshot}=await readConfigFileSnapshotForWrite();console.log(JSON.stringify(snapshot.config));`,
    ]),
  );
}

await mkdir(join(directory, 'bin'), { recursive: true });
await writeFile(
  join(directory, 'bin/openclaw'),
  `#!/bin/sh\nexec '${node.replaceAll("'", "'\\''")}' '${join(dirname(fileURLToPath(import.meta.resolve('openclaw/package.json'))), 'openclaw.mjs').replaceAll("'", "'\\''")}' "$@"\n`,
);
await chmod(join(directory, 'bin/openclaw'), EXECUTABLE_MODE);
console.log(`Testing ${packageSpec} in disposable workspace ${directory}`);
const model = startModel();
let app: Awaited<ReturnType<typeof startApp>> | undefined;
let owner: Awaited<ReturnType<typeof ownerBrowser>> | undefined;
let gateway: ReturnType<typeof Bun.spawn> | undefined;
async function waitGateway(): Promise<void> {
  const startupTimeoutMs = 60_000;
  const probeTimeoutMs = 1_000;
  const pollIntervalMs = 200;
  const deadline = Date.now() + startupTimeoutMs;
  while (Date.now() < deadline) {
    if (
      await fetch(`http://127.0.0.1:${gatewayPort}/readyz`, {
        signal: AbortSignal.timeout(probeTimeoutMs),
      })
        .then((response) => response.ok)
        .catch(() => false)
    ) {
      return;
    }
    if (gateway?.exitCode !== null) {
      throw new Error(
        `Disposable gateway exited before becoming ready:\n${await Bun.file(join(directory, 'gateway.log')).text()}\n${await Bun.file(join(directory, 'gateway-error.log')).text()}`,
      );
    }
    await Bun.sleep(pollIntervalMs);
  }
  throw new Error('Disposable gateway did not become ready.');
}
try {
  app = await startApp({ repo, directory, node });
  owner = await ownerBrowser(app.origin);
  console.log('Owner registered through virtual passkey.');
  const workspace = join(stateDir, 'workspace');
  await mkdir(workspace, { recursive: true });
  const initialAgents = '# Workspace\n\nBe concise.\n';
  const initialUser = '# User\n\nRowan is building Context Use. Likes architecture.\n';
  await writeFile(join(workspace, 'AGENTS.md'), initialAgents);
  await writeFile(join(workspace, 'USER.md'), initialUser);
  await configure(
    `config.session = { dmScope: 'per-channel-peer' }; config.tools = { profile: 'coding' }; config.agents={defaults:{workspace:${JSON.stringify(workspace)}}}; config.gateway={mode:'local',port:${gatewayPort},auth:{mode:'token',token:${JSON.stringify(crypto.randomUUID())}}};`,
  );
  await configure(`config.agents ??= {}; config.agents.defaults ??= {}; config.agents.defaults.workspace=${JSON.stringify(workspace)};
config.agents.defaults.model={primary:'fixture/memory-fixture'};
config.tools={...config.tools,codeMode:{enabled:false},toolSearch:{enabled:false}};
config.models={providers:{fixture:{baseUrl:${JSON.stringify(`${model.origin}/v1`)},apiKey:'fixture',api:'openai-completions',models:[{id:'memory-fixture',name:'Memory fixture',reasoning:false,input:['text'],contextWindow:100000,maxTokens:4000}]}}};`);
  const personalGroup = 'agent:main:telegram:group:-100123';
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  const installCommand = `OPENCLAW_STATE_DIR=${quote(stateDir)} OPENCLAW_CONFIG_PATH=${quote(env.OPENCLAW_CONFIG_PATH)} PATH=${quote(env.PATH)} npx --yes ${quote(packageSpec)}`;
  model.setup(`${installCommand} connect ${quote(app.origin)}`);
  const setupPrompt = openclawSetupPrompt(app.origin).replaceAll(
    OPENCLAW_INSTALL_COMMAND,
    installCommand,
  );
  await command([
    'openclaw',
    'agent',
    '--local',
    '--agent',
    'main',
    '--session-key',
    `${personalGroup}:topic:1`,
    '--message',
    setupPrompt,
    '--json',
  ]);
  assert(model.observations.setupCalls > 1, 'The real agent did not execute installation');
  console.log('Real OpenClaw agent installed the package and started authorization.');

  assert((await Bun.file(connectionFile).json()).oauth.pending?.url);
  const before = await configuration();
  assert.notEqual(
    before.plugins?.slots?.memory,
    PLUGIN_ID,
    'Installation activated memory before authorization',
  );
  await command(['npx', '--yes', packageSpec, 'remove']);
  assert(!(await Bun.file(connectionFile).exists()), 'Cancelled setup retained credentials');
  assert(!(await configuration()).plugins.entries?.[PLUGIN_ID]);
  await command(['npx', '--yes', packageSpec, 'connect', app.origin]);
  const pending = await Bun.file(connectionFile).json();
  console.log('Removed an unfinished installation through the npm helper and connected again.');
  const redirectUrl = await owner.authorize({
    authorizationUrl: pending.oauth.pending.url,
    callbackUrl: CALLBACK_URL,
    clientName: 'OpenClaw first installation',
  });
  const swapped = new URL(redirectUrl);
  swapped.searchParams.set('state', 'another-connection');
  const authorize = (url: string) =>
    command({ args: ['npx', '--yes', packageSpec, 'authorize'], stdin: url });
  await assert.rejects(authorize(swapped.href));
  model.setup(`printf '%s' ${quote(redirectUrl)} | ${installCommand} authorize`);
  await command([
    'openclaw',
    'agent',
    '--local',
    '--agent',
    'main',
    '--session-key',
    `${personalGroup}:topic:1`,
    '--message',
    `Finish connecting using this authorization response: ${redirectUrl}`,
    '--json',
  ]);
  model.learn();
  await assert.rejects(authorize(redirectUrl));
  const expired = await Bun.file(connectionFile).json();
  expired.oauth.tokens.access_token = 'expired-test-access-token';
  await writeFile(connectionFile, JSON.stringify(expired), { mode: PRIVATE_MODE });
  const connected = await configuration();
  assert.equal(connected.session.dmScope, 'per-channel-peer');
  assert.equal(connected.plugins.slots.memory, PLUGIN_ID);
  assert.equal(connected.plugins.entries['active-memory'].config.mode, 'always');
  assert(connected.plugins.entries['active-memory'].config.allowedChatTypes.includes('group'));
  assert((await command(['openclaw', 'context-use', 'status'])).includes('"connected": true'));
  console.log('Native installation and pasted callback authorization passed.');

  await command(['npx', '--yes', packageSpec, 'connect', app.origin]);
  assert((await Bun.file(connectionFile).json()).oauth.tokens);
  console.log('Reconnect retained the current connection without another authorization.');

  assert.equal(await Bun.file(join(workspace, 'AGENTS.md')).text(), initialAgents);
  assert.equal(await Bun.file(join(workspace, 'USER.md')).text(), initialUser);
  await writeFile(join(workspace, 'USER.md'), `${initialUser}\nLOCAL_MEMORY_CANARY`);
  await writeFile(join(workspace, 'MEMORY.md'), 'LOCAL_MEMORY_CANARY');
  const learn = await command([
    'openclaw',
    'agent',
    '--local',
    '--channel',
    'telegram',
    '--agent',
    'main',
    '--session-key',
    `${personalGroup}:topic:1`,
    '--message',
    "I'm Rowan. My sister Mira is studying architecture.",
    '--json',
  ]);
  assert.equal(
    JSON.parse(learn).meta.toolSummary.failures,
    1,
    'The deliberately missing page was not reported as a native tool failure',
  );
  assert(
    model.observations.tools.has('context_use_create_knowledge_page'),
    'Real native agent never wrote the page',
  );
  model.recall();
  const recall = await command([
    'openclaw',
    'agent',
    '--local',
    '--channel',
    'telegram',
    '--agent',
    'main',
    '--session-key',
    `${personalGroup}:topic:2`,
    '--message',
    'What does my sister study?',
    '--json',
  ]);
  assert(recall.includes('architecture'), recall);
  assert(model.observations.recallCalls > 1, 'Agentic recall did not make repeated model calls');
  assert(
    model.observations.tools.has('context_use_read_knowledge_page'),
    'Recall never followed a typed page address',
  );
  console.log(
    'Real OpenClaw agent learned in one personal Telegram forum topic and recalled in another under the coding tool profile; local bootstrap memory was excluded.',
  );

  model.recall();
  const directRecall = await command([
    'openclaw',
    'agent',
    '--local',
    '--channel',
    'webchat',
    '--agent',
    'main',
    '--session-key',
    'agent:main:webchat:direct:owner',
    '--message',
    'What does my sister study?',
    '--json',
  ]);
  assert(directRecall.includes('architecture'));
  model.recall();
  const channelRecall = await command([
    'openclaw',
    'agent',
    '--local',
    '--channel',
    'slack',
    '--agent',
    'main',
    '--session-key',
    'agent:main:slack:channel:123',
    '--message',
    'What does my sister study?',
    '--json',
  ]);
  assert(channelRecall.includes('architecture'));
  console.log(
    'The default install recalls across groups, forum topics, direct conversations and channels.',
  );

  const editedAgents = `${initialAgents}\nKeep my later style edit.\n`;
  await writeFile(join(workspace, 'AGENTS.md'), editedAgents);
  await configure(
    "config.plugins.entries['active-memory'].config.timeoutMs=45000; config.agents.entries.main.tools.alsoAllow.push('read');",
  );
  await command(['openclaw', 'context-use', 'disconnect']);
  const removed = await configuration();
  assert.equal(removed.session.dmScope, 'per-channel-peer');
  assert.equal(removed.plugins.entries['active-memory'].config.timeoutMs, USER_TIMEOUT_MS);
  assert.notEqual(removed.plugins.slots?.memory, PLUGIN_ID);
  assert(!(await Bun.file(connectionFile).exists()), 'Credentials survived disconnect');
  await owner.page.goto(`${app.origin}/map`);
  const remote = await owner.page.request.get(`${app.origin}/api/pages`);
  assert(remote.ok(), 'Could not verify memories survived disconnect');
  assert((await remote.text()).includes('Mira'), 'Disconnect removed remote memories');
  await command(['npx', '--yes', packageSpec, 'remove']);
  const afterRemoval = await configuration();
  assert(!afterRemoval.plugins.entries?.[PLUGIN_ID], 'Native uninstall tombstone survived');
  assert.deepEqual(afterRemoval.agents.entries.main.tools.alsoAllow, ['read']);
  assert.equal(await Bun.file(join(workspace, 'AGENTS.md')).text(), editedAgents);
  assert.equal(
    await Bun.file(join(workspace, 'USER.md')).text(),
    `${initialUser}\nLOCAL_MEMORY_CANARY`,
  );
  model.removed();
  const cleanChat = await command([
    'openclaw',
    'agent',
    '--local',
    '--channel',
    'telegram',
    '--agent',
    'main',
    '--session-key',
    `${personalGroup}:topic:3`,
    '--message',
    'What do you know about me?',
    '--json',
  ]);
  assert(cleanChat.includes('Local memory is available'));
  assert(model.observations.removedCalls > 0, 'No post-removal model request was inspected');
  console.log(
    'Removal restored setup-owned settings, preserved workspace files, later edits and remote memory, and exposed only the restored memory provider in a fresh chat.',
  );

  await command(['npx', '--yes', packageSpec, 'connect', app.origin]);
  console.log('Package reinstalled; authorizing the new connection.');
  const reconnect = await Bun.file(connectionFile).json();
  const newRedirect = await owner.authorize({
    authorizationUrl: reconnect.oauth.pending.url,
    callbackUrl: CALLBACK_URL,
    clientName: 'OpenClaw reinstallation',
  });
  await authorize(newRedirect);
  model.recall();
  const reinstalledRecall = await command([
    'openclaw',
    'agent',
    '--local',
    '--channel',
    'telegram',
    '--agent',
    'main',
    '--session-key',
    `${personalGroup}:topic:4`,
    '--message',
    'What does my sister study?',
    '--json',
  ]);
  assert(reinstalledRecall.includes('architecture'));
  gateway = Bun.spawn(['openclaw', 'gateway', 'run'], {
    cwd: directory,
    // This test owns restart and shutdown, even under CI's service manager.
    env: { ...env, OPENCLAW_NO_RESPAWN: '1' },
    stdout: Bun.file(join(directory, 'gateway.log')),
    stderr: Bun.file(join(directory, 'gateway-error.log')),
  });
  await waitGateway();
  console.log('Disposable gateway is ready; removing the installed plugin.');
  // Run removal from the installed command too: it must finish after uninstalling itself.
  console.log(await command(['openclaw', 'context-use', 'remove']));
  assert(!(await Bun.file(connectionFile).exists()));
  // OpenClaw may reload itself as configuration changes. Verify the next chat's
  // provider below, regardless of whether removal needed to request another refresh.
  await waitGateway();
  model.removed();
  const gatewayChat = await command([
    'openclaw',
    'agent',
    '--channel',
    'telegram',
    '--agent',
    'main',
    '--session-key',
    `${personalGroup}:topic:5`,
    '--message',
    'What do you know about me?',
    '--json',
  ]);
  assert(gatewayChat.includes('Local memory is available'));
  console.log(
    'Reinstalled in the same profile, recalled the preserved remote memory, removed through the native plugin command, and verified a fresh chat through the refreshed gateway.',
  );
  const refresh = await command(['npx', '--yes', packageSpec, 'refresh']);
  assert(refresh.includes('Gateway refresh requested'));
  await waitGateway();
  const inventory = JSON.parse(await command(['openclaw', 'plugins', 'list', '--json']));
  assert(!inventory.plugins.some((plugin: { id: string }) => plugin.id === PLUGIN_ID));
  assert(!(await Bun.file(connectionFile).exists()));
  console.log('The npm helper refreshed the gateway after uninstall.');
} finally {
  try {
    await owner?.close();
  } finally {
    model.stop();
    try {
      await app?.stop();
    } finally {
      gateway?.kill('SIGTERM');
      await gateway?.exited;
      await rm(directory, { recursive: true, force: true });
    }
  }
}
