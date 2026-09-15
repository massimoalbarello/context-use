import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerOwner } from '@repo/browser-testing/auth';
import { virtualPasskeyBrowser } from '@repo/browser-testing/browser';
import { runBrowser, stopBrowserHarness } from '@repo/browser-testing/harness';
import {
  BACKEND_ENVIRONMENT,
  LOCAL_PUBLIC_ORIGIN,
} from '../apps/context-use/backend/src/lib/runtime-config';

const INTERRUPTED_EXIT_CODE = 130;
const TERMINATED_EXIT_CODE = 143;
const APP_URL = LOCAL_PUBLIC_ORIGIN;
const APP_START_TIMEOUT_MS = 90_000;
const APP_PROBE_TIMEOUT_MS = 1_000;
const APP_PROBE_INTERVAL_MS = 200;
const ISOLATED_DEVELOPMENT_SEED_FOLDER = join(import.meta.dir, '../apps/context-use/demo/fixtures');
const ISOLATED_DEVELOPMENT_SEED_SCRIPT = join(ISOLATED_DEVELOPMENT_SEED_FOLDER, 'seed.py');
const seedIsolatedData = Bun.argv.includes('--seed');

const appUrlAlreadyInUse = await fetch(APP_URL, {
  signal: AbortSignal.timeout(APP_PROBE_TIMEOUT_MS),
})
  .then(() => true)
  .catch(() => false);
if (appUrlAlreadyInUse) {
  throw new Error(`${APP_URL} is already in use; stop the existing development app first`);
}

const dataFolder = await mkdtemp(join(tmpdir(), 'context-use-dev-'));
console.log(`Starting development servers with disposable data in ${dataFolder}`);

const developmentProcess = Bun.spawn(['bun', 'run', '--no-orphans', 'dev'], {
  env: {
    ...process.env,
    [BACKEND_ENVIRONMENT.dataFolder]: dataFolder,
    VITE_ISOLATED_CALENDAR_NOW: seedIsolatedData ? '2007-10-17T12:00:00' : undefined,
  },
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

let browser: Awaited<ReturnType<typeof virtualPasskeyBrowser>> | undefined;
let harnessStarted = false;
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
      const response = await fetch(new URL('/api/health', APP_URL), {
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
    browser = await virtualPasskeyBrowser({ headless: false });
    if (seedIsolatedData) {
      await registerOwner({ page: browser.page, origin: APP_URL });
      harnessStarted = true;
      console.log(
        await runBrowser({
          source: `switch_tab(${JSON.stringify(browser.targetId)})\n${await Bun.file(ISOLATED_DEVELOPMENT_SEED_SCRIPT).text()}`,
          env: {
            ...browser.harnessEnv,
            CONTEXT_USE_APP_URL: APP_URL,
            CONTEXT_USE_SEED_FOLDER: ISOLATED_DEVELOPMENT_SEED_FOLDER,
          },
        }),
      );
      console.log('Seeded isolated development data');
    } else {
      await browser.page.goto(APP_URL);
    }
    console.log(`Virtual passkey ready at ${APP_URL}`);

    const exitCode = await developmentProcess.exited;
    process.exitCode = signalExitCode ?? exitCode;
  }
} finally {
  process.off('SIGINT', stopForInterrupt);
  process.off('SIGTERM', stopForTermination);

  try {
    try {
      if (browser && harnessStarted) {
        await stopBrowserHarness(browser.harnessEnv);
      }
    } finally {
      await browser?.close();
    }
  } finally {
    if (developmentProcess.exitCode === null) {
      developmentProcess.kill('SIGTERM');
      await developmentProcess.exited;
    }
    await rm(dataFolder, { recursive: true, force: true });
    console.log('Removed disposable development data');
  }
}
