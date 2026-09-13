import assert from 'node:assert/strict';

const START_TIMEOUT_MS = 30_000;
const STOP_TIMEOUT_MS = 5_000;
const REQUEST_TIMEOUT_MS = 5_000;

export async function startBinary({
  executable,
  cwd,
  env,
}: {
  executable: string;
  cwd: string;
  env?: Record<string, string>;
}) {
  const child = Bun.spawn([executable], {
    cwd,
    env: { ...process.env, ...env, PORT: '0' },
    stdout: 'pipe',
    stderr: 'inherit',
  });

  async function terminate() {
    if (child.exitCode !== null) {
      return child.exitCode;
    }
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), STOP_TIMEOUT_MS);
    try {
      return await child.exited;
    } finally {
      clearTimeout(timer);
    }
  }

  let startupTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    const address = await Promise.race([
      listeningAddress(child.stdout),
      // biome-ignore lint/complexity/useMaxParams: native Promise executor signature
      new Promise<never>((_resolve, reject) => {
        startupTimer = setTimeout(
          () => reject(new Error(`Binary startup timed out: ${executable}`)),
          START_TIMEOUT_MS,
        );
      }),
    ]);

    return {
      request({ path, ...init }: RequestInit & { path: string }) {
        return fetch(new URL(path, address), {
          ...init,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      },
      async stop() {
        assert.equal(await terminate(), 0, `Binary must shut down cleanly: ${executable}`);
      },
      async [Symbol.asyncDispose]() {
        await terminate();
      },
    };
  } catch (error) {
    await terminate();
    throw error;
  } finally {
    clearTimeout(startupTimer);
  }
}

async function listeningAddress(stdout: ReadableStream<Uint8Array>): Promise<URL> {
  let output = '';
  const decoder = new TextDecoder();
  for await (const chunk of stdout.values({ preventCancel: true })) {
    output += decoder.decode(chunk, { stream: true });
    const match = output.match(/listening on (http:\/\/[^\s]+)/);
    if (match) {
      const url = new URL(match[1]!);
      url.hostname = '127.0.0.1';
      return url;
    }
  }
  throw new Error(`Binary exited before listening: ${output}`);
}
