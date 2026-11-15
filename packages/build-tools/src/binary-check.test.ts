import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startBinary } from './binary-check.ts';

const OK = 200;
const TEST_TIMEOUT_MS = 30_000;

test(
  'discovers compiled servers from JSON instance logs and plain-text demo logs',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'context-use-binary-logging-'));
    try {
      const entrypoint = join(directory, 'server.ts');
      const executable = join(directory, 'server');
      await Bun.write(
        entrypoint,
        `const server = Bun.serve({ port: Number(process.env.PORT), fetch: () => new Response('ready') });
const message = 'listening on ' + server.url.origin;
console.log(process.env.STARTUP_LOG_FORMAT === 'json'
  ? JSON.stringify({ level: 'info', name: 'main', msg: message })
  : 'Public read-only demo ' + message);
process.on('SIGTERM', () => { server.stop(true); process.exit(0); });
`,
      );
      const build = await Bun.build({
        entrypoints: [entrypoint],
        compile: { outfile: executable },
      });
      expect(build.success).toBe(true);
      for (const format of ['json', 'text']) {
        await using binary = await startBinary({
          executable,
          cwd: directory,
          env: { STARTUP_LOG_FORMAT: format },
        });
        const response = await binary.request({ path: '/health' });
        expect(response.status).toBe(OK);
        expect(await response.text()).toBe('ready');
        await binary.stop();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
  TEST_TIMEOUT_MS,
);
