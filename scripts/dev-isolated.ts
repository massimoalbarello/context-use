import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BACKEND_ENVIRONMENT, LOCAL_PUBLIC_ORIGIN } from '../apps/backend/src/lib/runtime-config';

const INTERRUPTED_EXIT_CODE = 130;
const TERMINATED_EXIT_CODE = 143;
const FAILURE_EXIT_CODE = 1;
const APP_URL = LOCAL_PUBLIC_ORIGIN;
const APP_START_TIMEOUT_MS = 30_000;
const APP_PROBE_TIMEOUT_MS = 1_000;
const APP_PROBE_INTERVAL_MS = 200;
const BROWSER_HARNESS_NAME = 'context-use-isolated';
const DEDICATED_BROWSER_URL = 'http://127.0.0.1:9223';
const BROWSER_SCRIPTS_FOLDER = join(import.meta.dir, '..', '.agents', 'scripts');
const ISOLATED_DEVELOPMENT_SEED_FOLDER = join(import.meta.dir, 'seeds', 'isolated-development');
const ISOLATED_DEVELOPMENT_SEED_SCRIPT = join(ISOLATED_DEVELOPMENT_SEED_FOLDER, 'seed.py');
const seedIsolatedData = Bun.argv.includes('--seed');
const useDedicatedBrowser = Bun.argv.includes('--dedicated-browser');
const browserEnvironment = useDedicatedBrowser
  ? { BU_NAME: BROWSER_HARNESS_NAME, BU_CDP_URL: DEDICATED_BROWSER_URL }
  : {};

const appUrlAlreadyInUse = await fetch(APP_URL, {
  signal: AbortSignal.timeout(APP_PROBE_TIMEOUT_MS),
})
  .then(() => true)
  .catch(() => false);
if (appUrlAlreadyInUse) {
  throw new Error(`${APP_URL} is already in use; stop the existing development app first`);
}

const browserExecutable = Bun.which('browser-harness');
if (!browserExecutable) {
  console.error(
    [
      'Virtual passkey testing requires the browser-harness CLI.',
      'Install it with:',
      '  uv tool install --python 3.12 browser-harness',
    ].join('\n'),
  );
  process.exit(FAILURE_EXIT_CODE);
}

if (useDedicatedBrowser) {
  const dedicatedBrowserReady = await fetch(`${DEDICATED_BROWSER_URL}/json/version`, {
    signal: AbortSignal.timeout(APP_PROBE_TIMEOUT_MS),
  })
    .then((response) => response.ok)
    .catch(() => false);
  if (!dedicatedBrowserReady) {
    throw new Error(
      `No dedicated browser is available at ${DEDICATED_BROWSER_URL}; start it before retrying`,
    );
  }
}

const runBrowserScripts = async (scriptPaths: string[]) => {
  const scriptParts = await Promise.all(
    scriptPaths.map(async (scriptPath) => {
      return `${await Bun.file(scriptPath).text()}\n`;
    }),
  );
  const browserProcess = Bun.spawn([browserExecutable], {
    env: {
      ...process.env,
      ...browserEnvironment,
      CONTEXT_USE_APP_URL: APP_URL,
      CONTEXT_USE_SEED_FOLDER: ISOLATED_DEVELOPMENT_SEED_FOLDER,
    },
    stdin: new Blob(scriptParts),
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const exitCode = await browserProcess.exited;
  if (exitCode !== 0) {
    throw new Error(`${browserExecutable} failed while running ${scriptPaths.join(', ')}`);
  }
};

const stopBrowserHarness = async () => {
  const browserProcess = Bun.spawn([browserExecutable, '--reload'], {
    env: { ...process.env, ...browserEnvironment },
    stdout: 'ignore',
    stderr: 'inherit',
  });
  if ((await browserProcess.exited) !== 0) {
    throw new Error('Could not stop the dedicated browser harness');
  }
};

const focusBrowserForPasskey = async () => {
  if (process.platform !== 'darwin') {
    return;
  }
  const focusProcess = Bun.spawn(
    ['osascript', '-e', 'tell application "Google Chrome" to activate'],
    { stdout: 'inherit', stderr: 'inherit' },
  );
  if ((await focusProcess.exited) !== 0) {
    throw new Error('Could not focus Google Chrome for passkey registration');
  }
};

const dataFolder = await mkdtemp(join(tmpdir(), 'context-use-dev-'));
console.log(`Starting development servers with disposable data in ${dataFolder}`);

const developmentProcess = Bun.spawn(['bun', 'run', '--no-orphans', 'dev'], {
  env: { ...process.env, [BACKEND_ENVIRONMENT.dataFolder]: dataFolder },
  stdio: ['inherit', 'inherit', 'inherit'],
});

let signalExitCode: number | undefined;
const stopForInterrupt = () => {
  signalExitCode = INTERRUPTED_EXIT_CODE;
  developmentProcess.kill('SIGINT');
};
const stopForTermination = () => {
  signalExitCode = TERMINATED_EXIT_CODE;
  developmentProcess.kill('SIGTERM');
};

process.on('SIGINT', stopForInterrupt);
process.on('SIGTERM', stopForTermination);

let authenticatorEnabled = false;
try {
  const startupDeadline = Date.now() + APP_START_TIMEOUT_MS;
  let appReady = false;
  while (Date.now() < startupDeadline) {
    if (developmentProcess.exitCode !== null) {
      if (signalExitCode !== undefined) {
        break;
      }
      throw new Error(
        `Development servers exited with code ${developmentProcess.exitCode} before ${APP_URL} was ready`,
      );
    }

    try {
      const response = await fetch(APP_URL, {
        signal: AbortSignal.timeout(APP_PROBE_TIMEOUT_MS),
      });
      if (response.ok) {
        appReady = true;
        break;
      }
    } catch {
      // The development servers are still starting.
    }
    await Bun.sleep(APP_PROBE_INTERVAL_MS);
  }

  if (!appReady) {
    if (signalExitCode === undefined) {
      throw new Error(`Timed out waiting for ${APP_URL}`);
    }
    process.exitCode = signalExitCode;
  } else {
    if (seedIsolatedData) {
      if (!useDedicatedBrowser) {
        await focusBrowserForPasskey();
      }
      await runBrowserScripts([
        join(BROWSER_SCRIPTS_FOLDER, 'enable-virtual-webauthn.py'),
        ISOLATED_DEVELOPMENT_SEED_SCRIPT,
      ]);
      console.log('Seeded isolated development data');
    } else {
      await runBrowserScripts([join(BROWSER_SCRIPTS_FOLDER, 'enable-virtual-webauthn.py')]);
    }
    authenticatorEnabled = true;
    console.log(`Virtual passkey ready at ${APP_URL}`);

    const exitCode = await developmentProcess.exited;
    process.exitCode = signalExitCode ?? exitCode;
  }
} finally {
  process.off('SIGINT', stopForInterrupt);
  process.off('SIGTERM', stopForTermination);

  if (authenticatorEnabled) {
    try {
      await runBrowserScripts([join(BROWSER_SCRIPTS_FOLDER, 'disable-virtual-webauthn.py')]);
    } catch (error) {
      console.error('Failed to disable the virtual WebAuthn authenticator', error);
      process.exitCode ||= FAILURE_EXIT_CODE;
    }
  }

  if (useDedicatedBrowser) {
    try {
      await stopBrowserHarness();
    } catch (error) {
      console.error('Failed to stop the dedicated browser harness', error);
      process.exitCode ||= FAILURE_EXIT_CODE;
    }
  }

  if (developmentProcess.exitCode === null) {
    developmentProcess.kill('SIGTERM');
    await developmentProcess.exited;
  }
  await rm(dataFolder, { recursive: true, force: true });
  console.log('Removed disposable development data');
}
