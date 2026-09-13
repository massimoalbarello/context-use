import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readState, withConnection, writeState } from '../src/state';

test('serializes rotating credentials and stores them privately', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'context-use-state-test-'));
  const expectedMode = 0o600;
  const permissionMask = 0o777;
  try {
    await withConnection({
      directory,
      run: () =>
        writeState({
          directory,
          state: {
            config: { serverUrl: 'https://memory.example/mcp', agentId: 'main' },
            tools: [],
            changes: [],
            oauth: { verifier: '0' },
          },
        }),
    });
    await writeFile(join(directory, 'connection.json.tmp'), 'interrupted-secret', {
      mode: expectedMode,
    });
    const advance = () =>
      withConnection({
        directory,
        run: async () => {
          const state = (await readState(directory))!;
          state.oauth.verifier = String(Number(state.oauth.verifier) + 1);
          await writeState({ directory, state });
        },
      });
    await Promise.all([advance(), advance()]);
    expect((await readState(directory))!.oauth.verifier).toBe('2');
    expect((await stat(join(directory, 'connection.json'))).mode & permissionMask).toBe(
      expectedMode,
    );
    const persisted = await readFile(join(directory, 'connection.json'), 'utf8');
    expect(persisted).not.toContain('knowledge');
    expect(await Bun.file(join(directory, 'connection.json.tmp')).exists()).toBe(false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
