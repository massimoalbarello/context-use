import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerOwner } from '@repo/browser-testing/auth';
import { virtualPasskeyBrowser } from '@repo/browser-testing/browser';
import { runBrowser, stopBrowserHarness } from '@repo/browser-testing/harness';
import { BACKEND_ENVIRONMENT } from '../apps/context-use/backend/src/lib/runtime-config';
import { reserveIsolatedPort } from './isolated-port';

const INTERRUPTED_EXIT_CODE = 130;
const TERMINATED_EXIT_CODE = 143;
const HANGUP_EXIT_CODE = 129;
const APP_START_TIMEOUT_MS = 90_000;
const APP_PROBE_TIMEOUT_MS = 1_000;
const APP_PROBE_INTERVAL_MS = 200;
const ISOLATED_DEVELOPMENT_SEED_FOLDER = join(import.meta.dir, '../apps/context-use/demo/fixtures');
const ISOLATED_DEVELOPMENT_SEED_SCRIPT = join(ISOLATED_DEVELOPMENT_SEED_FOLDER, 'seed.py');
const seedIsolatedData = Bun.argv.includes('--seed');

async function waitForApp(input: { origin: string; signal: AbortSignal }): Promise<void> {
  const startupDeadline = Date.now() + APP_START_TIMEOUT_MS;
  while (Date.now() < startupDeadline) {
    input.signal.throwIfAborted();
    try {
      const response = await fetch(new URL('/api/health', input.origin), {
        signal: AbortSignal.any([input.signal, AbortSignal.timeout(APP_PROBE_TIMEOUT_MS)]),
      });
      if (response.ok) {
        return;
      }
    } catch {
      // The development servers are still starting.
    }
    await Bun.sleep(APP_PROBE_INTERVAL_MS);
  }
  throw new Error(`Timed out waiting for ${input.origin}`);
}

async function main(): Promise<number> {
  const dataFolder = await mkdtemp(join(tmpdir(), 'context-use-dev-'));
  let developmentProcess: ReturnType<typeof Bun.spawn> | undefined;
  let browser: Awaited<ReturnType<typeof virtualPasskeyBrowser>> | undefined;
  const ports: Awaited<ReturnType<typeof reserveIsolatedPort>>[] = [];
  const stop = new AbortController();
  let exitCode = 0;
  const stopSession = (code: number) => {
    if (stop.signal.aborted) {
      return;
    }
    exitCode = code;
    stop.abort();
    developmentProcess?.kill('SIGTERM');
    // Interrupt registration/navigation as well as the browser-harness child.
    void browser?.close().catch(console.error);
  };
  const interrupt = () => stopSession(INTERRUPTED_EXIT_CODE);
  const terminate = () => stopSession(TERMINATED_EXIT_CODE);
  const hangup = () => stopSession(HANGUP_EXIT_CODE);
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminate);
  process.on('SIGHUP', hangup);

  try {
    const backendPort = await reserveIsolatedPort();
    ports.push(backendPort);
    const frontendPort = await reserveIsolatedPort();
    ports.push(frontendPort);
    stop.signal.throwIfAborted();
    const appUrl = `http://localhost:${frontendPort.port}`;
    const environment = {
      ...process.env,
      [BACKEND_ENVIRONMENT.port]: String(backendPort.port),
      [BACKEND_ENVIRONMENT.baseUrl]: appUrl,
      [BACKEND_ENVIRONMENT.dataFolder]: dataFolder,
      FRONTEND_PORT: String(frontendPort.port),
      VITE_ISOLATED_CALENDAR_NOW: seedIsolatedData ? '2007-10-17T12:00:00' : undefined,
    };
    backendPort.handoff();
    frontendPort.handoff();
    console.log(`Starting isolated development at ${appUrl} with disposable data in ${dataFolder}`);
    developmentProcess = Bun.spawn(['bun', 'run', '--no-orphans', 'dev'], {
      cwd: join(import.meta.dir, '..'),
      env: environment,
      stdio: ['inherit', 'inherit', 'inherit'],
    });
    void developmentProcess.exited.then((code) => stopSession(code || 1));
    await waitForApp({ origin: appUrl, signal: stop.signal });
    browser = await virtualPasskeyBrowser({ headless: false });
    stop.signal.throwIfAborted();
    void browser.closed.then(() => stopSession(0));
    // Connection details contain no passkey credentials and belong only to this run.
    console.log(
      `Isolated browser session: ${JSON.stringify({
        pid: process.pid,
        appUrl,
        backendPort: Number(environment[BACKEND_ENVIRONMENT.port]),
        dataFolder,
        targetId: browser.targetId,
        ...browser.harnessEnv,
      })}`,
    );
    if (seedIsolatedData) {
      await registerOwner({ page: browser.page, origin: appUrl });
      console.log(
        await runBrowser({
          source: `switch_tab(${JSON.stringify(browser.targetId)})\n${await Bun.file(ISOLATED_DEVELOPMENT_SEED_SCRIPT).text()}`,
          env: {
            ...browser.harnessEnv,
            CONTEXT_USE_APP_URL: appUrl,
            CONTEXT_USE_SEED_FOLDER: ISOLATED_DEVELOPMENT_SEED_FOLDER,
          },
          signal: stop.signal,
        }),
      );
      console.log('Seeded isolated development data');
    } else {
      await browser.page.goto(appUrl);
    }
    console.log(`Virtual passkey ready at ${appUrl}`);
    console.log(
      `Stop this session with Ctrl-C or kill -TERM ${process.pid}; its browser closes too.`,
    );
    await developmentProcess.exited;
  } catch (error) {
    if (!stop.signal.aborted) {
      throw error;
    }
  } finally {
    stopSession(exitCode);
    try {
      try {
        if (browser) {
          await stopBrowserHarness(browser.harnessEnv);
        }
      } finally {
        await browser?.close();
      }
    } finally {
      if (developmentProcess) {
        await developmentProcess.exited;
      }
      await Promise.all([
        ...ports.map((port) => port.close()),
        rm(dataFolder, { recursive: true, force: true }),
      ]);
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', terminate);
      process.off('SIGHUP', hangup);
      console.log('Removed disposable development data');
    }
  }
  return exitCode;
}

process.exitCode = await main();
