import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { virtualPasskeyBrowser } from '@repo/browser-testing/browser';
import { ownerBrowser } from '@repo/browser-testing/owner-browser';
import { CALLBACK_URL } from '../src/contract';
import { LearningStore } from '../src/learning-store';
import { availablePort, startApp } from './e2e-app';
import { startModel } from './e2e-model';

const COMMAND_TIMEOUT_MS = 600_000;
const LEARNING_TIMEOUT_MS = 180_000;
const POLL_MS = 1_000;
const EXECUTABLE_MODE = 0o700;
const root = resolve(import.meta.dir, '..');
const directory = await mkdtemp(join(tmpdir(), 'context-use-learning-e2e-'));
console.log(`Testing background learning in ${directory}`);
const stateDir = join(directory, 'openclaw');
const node = process.env.OPENCLAW_TEST_NODE ?? Bun.which('node');
assert(node, 'Set OPENCLAW_TEST_NODE to a supported Node runtime');
const host = join(
  dirname(fileURLToPath(import.meta.resolve('openclaw/package.json'))),
  'openclaw.mjs',
);
const gatewayPort = availablePort();
const configPath = join(stateDir, 'openclaw.json');
const env = {
  ...process.env,
  OPENCLAW_STATE_DIR: stateDir,
  OPENCLAW_CONFIG_PATH: configPath,
  OPENCLAW_NO_RESPAWN: '1',
  PATH: `${join(directory, 'bin')}:${dirname(node)}:${process.env.PATH}`,
};
await mkdir(join(directory, 'bin'), { recursive: true });
await writeFile(join(directory, 'bin/openclaw'), `#!/bin/sh\nexec '${node}' '${host}' "$@"\n`);
await chmod(join(directory, 'bin/openclaw'), EXECUTABLE_MODE);

async function command(args: string[]) {
  const child = Bun.spawn(args, {
    cwd: directory,
    env,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: COMMAND_TIMEOUT_MS,
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  assert.equal(code, 0, `${args.slice(0, 2).join(' ')} failed: ${stdout}\n${stderr}`);
  return stdout;
}
const model = startModel();
model.background();
let app: Awaited<ReturnType<typeof startApp>> | undefined;
let owner: Awaited<ReturnType<typeof ownerBrowser>> | undefined;
let gateway: ReturnType<typeof Bun.spawn> | undefined;
let verification: Awaited<ReturnType<typeof virtualPasskeyBrowser>> | undefined;
try {
  app = await startApp({ repo: resolve(root, '../..'), directory, node });
  owner = await ownerBrowser(app.origin);
  await mkdir(stateDir, { recursive: true });
  const sdk = import.meta.resolve('openclaw/plugin-sdk/config-mutation');
  const config = {
    gateway: {
      mode: 'local',
      port: gatewayPort,
      controlUi: { enabled: false },
      auth: { mode: 'token', token: crypto.randomUUID() },
    },
    plugins: { allow: ['context-use', 'active-memory', 'openai'] },
    discovery: { mdns: { mode: 'off' } },
    agents: {
      defaults: {
        workspace: join(stateDir, 'workspace'),
        model: { primary: 'fixture/memory-fixture' },
      },
    },
    tools: { profile: 'coding', codeMode: { enabled: false }, toolSearch: { enabled: false } },
    models: {
      providers: {
        fixture: {
          baseUrl: `${model.origin}/v1`,
          apiKey: 'fixture',
          api: 'openai-completions',
          models: [
            {
              id: 'memory-fixture',
              name: 'Memory fixture',
              reasoning: false,
              input: ['text'],
              contextWindow: 100000,
              maxTokens: 4000,
            },
          ],
        },
      },
    },
  };
  await command([
    node,
    '--input-type=module',
    '-e',
    `import {mutateConfigFile} from ${JSON.stringify(sdk)}; await mutateConfigFile({mutate(c){Object.assign(c,${JSON.stringify(config)})}});`,
  ]);
  const artifacts = await Array.fromAsync(
    new Bun.Glob('*.tgz').scan({ cwd: join(root, 'release'), absolute: true }),
  );
  assert.equal(artifacts.length, 1);
  await command([
    'openclaw',
    'plugins',
    'install',
    artifacts[0]!,
    '--force',
    '--accept-capabilities',
  ]);
  console.log('Plugin installed in the disposable profile.');
  const connectionModule = JSON.stringify(resolve(root, 'src/connection.ts'));
  const connectionDirectory = JSON.stringify(join(stateDir, 'plugins/context-use'));
  await command([
    process.execPath,
    '--eval',
    `import { connect } from ${connectionModule}; await connect({ directory: ${connectionDirectory}, instance: ${JSON.stringify(app.origin)}, agentId: 'main' });`,
  ]);
  const connection = join(stateDir, 'plugins/context-use/connection.json');
  const pending = await Bun.file(connection).json();
  const callback = await owner.authorize({
    authorizationUrl: pending.oauth.pending.url,
    callbackUrl: CALLBACK_URL,
    clientName: 'Background learning test',
  });
  const cookies = await owner.page.context().cookies();
  await owner.close();
  owner = undefined;
  // Set up the connection without an unrelated CLI runtime-inspection subprocess.
  const auth = Bun.spawn(
    [
      process.execPath,
      '--eval',
      `import { finishAuthorization } from ${connectionModule}; await finishAuthorization({ directory: ${connectionDirectory}, redirectUrl: await Bun.stdin.text() });`,
    ],
    {
      cwd: directory,
      env,
      stdin: new Blob([callback]),
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: COMMAND_TIMEOUT_MS,
    },
  );
  const [authOutput, authError, authCode] = await Promise.all([
    new Response(auth.stdout).text(),
    new Response(auth.stderr).text(),
    auth.exited,
  ]);
  assert.equal(authCode, 0, `${authOutput}\n${authError}`);
  console.log('Disposable OpenClaw installed and authorized.');
  const sessionKey = 'agent:main:telegram:group:-100123:topic:6';
  const reply = await command([
    'openclaw',
    'agent',
    '--local',
    '--agent',
    'main',
    '--session-key',
    sessionKey,
    '--message',
    "I am Rowan. Liza is arriving in London tonight, 16 September 2026. I will pick her up at Stansted, travelling from Canary Wharf. I'll buy coach tickets once I'm there.",
    '--json',
  ]);
  assert(reply.includes('I can help with your trip.'));
  console.log('Foreground reply returned without memory calls; starting the background worker.');
  gateway = Bun.spawn(['openclaw', 'gateway', 'run'], {
    cwd: directory,
    env,
    stdout: Bun.file(join(directory, 'gateway.log')),
    stderr: Bun.file(join(directory, 'gateway-error.log')),
  });
  const readyDeadline = Date.now() + COMMAND_TIMEOUT_MS;
  let ready = false;
  while (Date.now() < readyDeadline) {
    ready = await fetch(`http://127.0.0.1:${gatewayPort}/readyz`)
      .then((r) => r.ok)
      .catch(() => false);
    if (ready || gateway.exitCode !== null) {
      break;
    }
    await Bun.sleep(POLL_MS);
  }
  assert(ready, await Bun.file(join(directory, 'gateway-error.log')).text());
  await command([
    'openclaw',
    'gateway',
    'call',
    'sessions.reset',
    '--params',
    JSON.stringify({ key: sessionKey, reason: 'new' }),
    '--json',
  ]);
  const deadline = Date.now() + LEARNING_TIMEOUT_MS;
  let learned = false;
  while (Date.now() < deadline) {
    const pages = await fetch(`${app.origin}/api/pages`, {
      headers: { cookie: cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ') },
    });
    if ((await pages.text()).includes('Stansted pickup')) {
      learned = true;
      break;
    }
    await Bun.sleep(POLL_MS);
  }
  assert(
    learned,
    `Background learning failed:\n${await Bun.file(join(directory, 'gateway-error.log')).text()}`,
  );
  assert(model.observations.backgroundCalls > 0);
  verification = await virtualPasskeyBrowser({ headless: true });
  await verification.page.context().addCookies(cookies);
  await verification.page.goto(`${app.origin}/map?resource=page&resourceId=stansted-pickup`);
  await verification.page
    .getByRole('heading', { name: 'Stansted pickup', exact: true })
    .first()
    .waitFor();
  const connected = await Bun.file(connection).json();
  const learning = new LearningStore({
    directory: join(stateDir, 'plugins/context-use'),
    config: connected.config,
    connectionId: connected.learningId,
  });
  try {
    while (Date.now() < deadline && learning.status().pending > 0) {
      await Bun.sleep(POLL_MS);
    }
    assert.equal(
      learning.status().pending,
      0,
      'The worker did not acknowledge and clear its evidence',
    );
  } finally {
    learning.close();
  }
  console.log(
    'A normal reply made no memory calls; the silent worker saved the plan across /new, and it is visible in the app.',
  );
} finally {
  gateway?.kill('SIGTERM');
  await gateway?.exited;
  await owner?.close();
  await verification?.close();
  model.stop();
  await app?.stop();
  await rm(directory, { recursive: true, force: true });
}
