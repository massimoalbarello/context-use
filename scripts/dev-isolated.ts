import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const INTERRUPTED_EXIT_CODE = 130;
const TERMINATED_EXIT_CODE = 143;
const FAILURE_EXIT_CODE = 1;
const APP_URL = 'http://localhost:5173';
const APP_START_TIMEOUT_MS = 30_000;
const APP_PROBE_TIMEOUT_MS = 1_000;
const APP_PROBE_INTERVAL_MS = 200;

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

const runBrowserScript = async (scriptName: string) => {
  const scriptPath = join(import.meta.dir, '..', '.agents', 'scripts', scriptName);
  const browserProcess = Bun.spawn([browserExecutable], {
    env: { ...process.env, CONTEXT_USE_APP_URL: APP_URL },
    stdin: Bun.file(scriptPath),
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const exitCode = await browserProcess.exited;
  if (exitCode !== 0) {
    throw new Error(`${browserExecutable} failed while running ${scriptName}`);
  }
};

const dataFolder = await mkdtemp(join(tmpdir(), 'context-use-dev-'));
console.log(`Starting development servers with disposable data in ${dataFolder}`);

const developmentProcess = Bun.spawn(['bun', 'run', '--no-orphans', 'dev'], {
  env: { ...process.env, DATA_FOLDER: dataFolder },
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
    await runBrowserScript('enable-virtual-webauthn.py');
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
      await runBrowserScript('disable-virtual-webauthn.py');
    } catch (error) {
      console.error('Failed to disable the virtual WebAuthn authenticator', error);
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
