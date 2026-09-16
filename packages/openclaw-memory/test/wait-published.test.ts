import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { waitForPublished } from '../scripts/wait-published';

const TEST_TIMEOUT_MS = 30_000;
const UNAUTHORIZED = 401;

test(
  'publication waits for the exact integrity and bounds registry propagation delays',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'context-use-registry-'));
    let misses = 1;
    let integrity = 'sha512-verified';
    let status = 404;
    const registry = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch() {
        if (misses-- > 0) {
          return Response.json({ error: 'unavailable' }, { status });
        }
        return Response.json({
          name: 'fixture',
          versions: {
            '1.0.0': { name: 'fixture', version: '1.0.0', dist: { integrity } },
          },
        });
      },
    });
    const options = {
      timeoutMs: 10_000,
      intervalMs: 1,
      env: { ...process.env, npm_config_registry: registry.url.href, npm_config_cache: directory },
    };
    try {
      await waitForPublished({ spec: 'fixture@1.0.0', integrity, ...options });
      integrity = 'sha512-wrong';
      await expect(
        waitForPublished({ spec: 'fixture@1.0.0', integrity: 'sha512-verified', ...options }),
      ).rejects.toThrow('different contents');
      misses = Number.POSITIVE_INFINITY;
      await expect(
        waitForPublished({ spec: 'fixture@1.0.0', integrity, ...options, timeoutMs: 1000 }),
      ).rejects.toThrow('Timed out');
      status = UNAUTHORIZED;
      await expect(
        waitForPublished({ spec: 'fixture@1.0.0', integrity, ...options }),
      ).rejects.toThrow();
    } finally {
      await registry.stop(true);
      await rm(directory, { recursive: true, force: true });
    }
  },
  TEST_TIMEOUT_MS,
);
