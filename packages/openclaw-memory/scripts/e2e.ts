import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ownerBrowser } from '@repo/browser-testing/owner-browser';
import { CALLBACK_URL, PLUGIN_ID } from '../src/contract';
import { startApp } from './e2e-app';
import { startModel } from './e2e-model';

const USER_TIMEOUT_MS = 45_000;
const PRIVATE_MODE = 0o600;
const EXECUTABLE_MODE = 0o700;
const COMMAND_TIMEOUT_MS = 180_000;
const root = resolve(import.meta.dir, '..');
const repo = resolve(root, '../..');
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
};
const setup = join(root, 'pkg/dist/setup.js');
const sdkConfig = 'openclaw/plugin-sdk/config-mutation';
const connectionFile = join(stateDir, 'plugins', PLUGIN_ID, 'connection.json');

async function command(args: string[]): Promise<string> {
  const process = Bun.spawn(args, {
    cwd: root,
    env,
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
    throw new Error(`Command ${args.slice(0, 2).join(' ')} failed (${code}): ${stderr}`);
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
console.log(`Testing in disposable workspace ${directory}`);
const model = startModel();
let app: Awaited<ReturnType<typeof startApp>> | undefined;
let owner: Awaited<ReturnType<typeof ownerBrowser>> | undefined;
try {
  app = await startApp({ repo, directory, node });
  owner = await ownerBrowser(app.origin);
  console.log('Owner registered through virtual passkey.');
  await configure("config.session = { dmScope: 'per-channel-peer' };");
  await command([node, setup, 'connect', app.origin]);
  const pending = await Bun.file(connectionFile).json();
  assert(pending.oauth.pending?.url);
  const before = await configuration();
  assert.notEqual(
    before.plugins?.slots?.memory,
    PLUGIN_ID,
    'Installation activated memory before authorization',
  );
  const redirectUrl = await owner.authorize({
    authorizationUrl: pending.oauth.pending.url,
    callbackUrl: CALLBACK_URL,
  });
  const callback = join(directory, 'callback.txt');
  const swapped = new URL(redirectUrl);
  swapped.searchParams.set('state', 'another-connection');
  await writeFile(callback, swapped.href, { mode: PRIVATE_MODE });
  await assert.rejects(command([node, setup, 'authorize', callback]));
  await writeFile(callback, redirectUrl, { mode: PRIVATE_MODE });
  await command([node, setup, 'authorize', callback]);
  await assert.rejects(command([node, setup, 'authorize', callback]));
  await rm(callback);
  const expired = await Bun.file(connectionFile).json();
  expired.oauth.tokens.access_token = 'expired-test-access-token';
  await writeFile(connectionFile, JSON.stringify(expired), { mode: PRIVATE_MODE });
  const connected = await configuration();
  assert.equal(connected.session.dmScope, 'per-channel-peer');
  assert.equal(connected.plugins.slots.memory, PLUGIN_ID);
  assert.equal(connected.plugins.entries['active-memory'].config.mode, 'always');
  assert((await command(['openclaw', 'context-use', 'status'])).includes('"connected": true'));
  console.log('Native installation and pasted callback authorization passed.');

  const workspace = join(stateDir, 'workspace');
  await mkdir(workspace, { recursive: true });
  await writeFile(join(workspace, 'USER.md'), 'LOCAL_MEMORY_CANARY');
  await writeFile(join(workspace, 'MEMORY.md'), 'LOCAL_MEMORY_CANARY');
  await configure(`config.agents ??= {}; config.agents.defaults ??= {}; config.agents.defaults.workspace=${JSON.stringify(workspace)};
config.agents.defaults.model={primary:'fixture/memory-fixture'};
config.tools={codeMode:{enabled:false},toolSearch:{enabled:false}};
config.models={providers:{fixture:{baseUrl:${JSON.stringify(`${model.origin}/v1`)},apiKey:'fixture',api:'openai-completions',models:[{id:'memory-fixture',name:'Memory fixture',reasoning:false,input:['text'],contextWindow:100000,maxTokens:4000}]}}};`);
  const learn = await command([
    'openclaw',
    'agent',
    '--local',
    '--channel',
    'telegram',
    '--agent',
    'main',
    '--session-key',
    'agent:main:telegram:direct:owner',
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
    'webchat',
    '--agent',
    'main',
    '--session-key',
    'agent:main:webchat:direct:owner',
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
    'Real OpenClaw agent learned in a Telegram session and recalled in a separate webchat session; local bootstrap memory was excluded.',
  );

  await configure("config.plugins.entries['active-memory'].config.timeoutMs=45000;");
  await command([node, setup, 'disconnect']);
  const removed = await configuration();
  assert.equal(removed.session.dmScope, 'per-channel-peer');
  assert.equal(removed.plugins.entries['active-memory'].config.timeoutMs, USER_TIMEOUT_MS);
  assert.notEqual(removed.plugins.slots?.memory, PLUGIN_ID);
  assert(!(await Bun.file(connectionFile).exists()), 'Credentials survived disconnect');
  await owner.page.goto(`${app.origin}/hypermedia`);
  const remote = await owner.page.request.get(`${app.origin}/api/pages`);
  assert(remote.ok(), 'Could not verify memories survived disconnect');
  assert((await remote.text()).includes('Mira'), 'Disconnect removed remote memories');
  await command([node, setup, 'remove']);
  console.log(
    'Disconnect restored configuration, preserved user edits and remote memory, and removed credentials; uninstall passed.',
  );
} finally {
  try {
    await owner?.close();
  } finally {
    model.stop();
    try {
      await app?.stop();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
