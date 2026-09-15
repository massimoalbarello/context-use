const BROWSER_TIMEOUT_MS = 180_000;
const SHUTDOWN_TIMEOUT_MS = 10_000;
const COMPLETED = '__CONTEXT_USE_BROWSER_COMPLETED__';

export async function runBrowser(input: {
  source: string;
  env?: Record<string, string | undefined>;
}): Promise<string> {
  const executable = Bun.which('browser-harness', { PATH: input.env?.PATH ?? process.env.PATH });
  if (!executable) {
    throw new Error(
      'Browser testing requires browser-harness: uv tool install --python 3.12 browser-harness',
    );
  }
  const child = Bun.spawn([executable], {
    env: { ...process.env, ...input.env },
    stdin: new Blob([input.source, `\nprint(${JSON.stringify(COMPLETED)}, flush=True)\n`]),
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: BROWSER_TIMEOUT_MS,
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0 || child.signalCode) {
    throw new Error(`Browser journey failed (${code}): ${stderr}`);
  }
  const completion = `${COMPLETED}\n`;
  if (!stdout.endsWith(completion)) {
    throw new Error('Browser process exited without completing the journey.');
  }
  return stdout.slice(0, -completion.length);
}

export async function stopBrowserHarness(env: Record<string, string>): Promise<void> {
  const executable = Bun.which('browser-harness');
  if (!executable) {
    return;
  }
  const shutdown = Bun.spawn([executable, '--reload'], {
    env: { ...process.env, ...env },
    timeout: SHUTDOWN_TIMEOUT_MS,
    stdout: 'ignore',
    stderr: 'ignore',
  });
  await shutdown.exited;
}
