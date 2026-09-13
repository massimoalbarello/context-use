import { join } from 'node:path';

const START_TIMEOUT_MS = 90_000;
const PROBE_TIMEOUT_MS = 1_000;
const PROBE_INTERVAL_MS = 200;

function availablePort(): number {
  const server = Bun.serve({ port: 0, fetch: () => new Response() });
  const port = server.port!;
  server.stop(true);
  return port;
}

/** Exercise the public app in disposable storage without importing application code. */
export async function startApp(input: { repo: string; directory: string; node: string }) {
  const backendPort = availablePort();
  const frontendPort = availablePort();
  const origin = `http://localhost:${frontendPort}`;
  const backend = Bun.spawn(
    ['bun', 'run', '--cwd', join(input.repo, 'apps/context-use'), 'dev:server'],
    {
      env: {
        ...process.env,
        PORT: String(backendPort),
        BASE_URL: origin,
        DATA_FOLDER: join(input.directory, 'data'),
      },
      stdout: Bun.file(join(input.directory, 'backend.log')),
      stderr: Bun.file(join(input.directory, 'backend-error.log')),
    },
  );
  const configuration = join(input.directory, 'vite.config.mts');
  await Bun.write(
    configuration,
    `import config from ${JSON.stringify(join(input.repo, 'apps/context-use/frontend/vite.config.ts'))};
for (const proxy of Object.values(config.server.proxy)) { proxy.target = 'http://localhost:${backendPort}'; }
config.server.port = ${frontendPort};
config.cacheDir = ${JSON.stringify(join(input.directory, 'vite-cache'))};
export default config;`,
  );
  const frontend = Bun.spawn(
    [
      input.node,
      join(input.repo, 'apps/context-use/node_modules/vite/bin/vite.js'),
      'dev',
      '--config',
      configuration,
    ],
    {
      cwd: join(input.repo, 'apps/context-use'),
      stdout: Bun.file(join(input.directory, 'frontend.log')),
      stderr: Bun.file(join(input.directory, 'frontend-error.log')),
    },
  );
  const stop = async () => {
    frontend.kill('SIGTERM');
    backend.kill('SIGTERM');
    await Promise.all([frontend.exited, backend.exited]);
  };
  try {
    const deadline = Date.now() + START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (
        await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
          .then((response) => response.ok)
          .catch(() => false)
      ) {
        return { origin, stop };
      }
      if (frontend.exitCode !== null || backend.exitCode !== null) {
        break;
      }
      await Bun.sleep(PROBE_INTERVAL_MS);
    }
    throw new Error(`Disposable app did not start. See logs in ${input.directory}.`);
  } catch (error) {
    await stop();
    throw error;
  }
}
