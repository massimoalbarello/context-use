import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runBrowser } from '../src/harness';

const EXECUTABLE_MODE = 0o700;

test('a successful process exit cannot stand in for a completed browser journey', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'context-use-browser-test-'));
  try {
    await writeFile(
      join(directory, 'browser-harness'),
      '#!/bin/sh\n/bin/cat >/dev/null\nexit 0\n',
      {
        mode: EXECUTABLE_MODE,
      },
    );
    await expect(
      runBrowser({ source: 'raise RuntimeError("Never executed")', env: { PATH: directory } }),
    ).rejects.toThrow('without completing the journey');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
