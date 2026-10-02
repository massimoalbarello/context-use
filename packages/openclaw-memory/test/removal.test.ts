import { expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { assertNotRemoving, removalStatus, runRemoval } from '../src/removal';
import { writeState } from '../src/state';

const WORKER_TEST_TIMEOUT_MS = 30_000;

test('an unrelated live PID cannot block removal recovery', async () => {
  const root = await mkdtemp(join(tmpdir(), 'context-use-removal-'));
  const directory = join(root, 'connection');
  try {
    await writeFile(`${directory}.removal.json`, JSON.stringify({ pid: process.pid }));
    expect(await removalStatus(directory)).toEqual({
      running: false,
      error: 'Removal was interrupted. Run remove again.',
    });
    await expect(assertNotRemoving(directory)).rejects.toThrow('Finish removing');
    let removed = false;
    await runRemoval({
      directory,
      run: () => {
        removed = true;
        return Promise.resolve();
      },
    });
    expect(removed).toBe(true);
    expect(await removalStatus(directory)).toBeUndefined();
    expect(existsSync(`${directory}.removal.json.lock`)).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a live worker excludes duplicates and an expired lease from a killed worker is recoverable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'context-use-removal-'));
  const directory = join(root, 'connection');
  await writeFile(`${directory}.removal.json`, '{}');
  const child = spawn(
    process.execPath,
    [
      '-e',
      `
    import { runRemoval } from ${JSON.stringify(resolve(import.meta.dir, '../src/removal.ts'))};
    await runRemoval({ directory: ${JSON.stringify(directory)}, run: () => new Promise(resolve => process.once('message', resolve)) });
  `,
    ],
    { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] },
  );
  try {
    await Promise.race([
      once(child, 'message'),
      once(child, 'exit').then(() => {
        throw new Error('Worker exited before acquiring its lease');
      }),
    ]);
    expect((await removalStatus(directory))?.running).toBe(true);
    let duplicateRan = false;
    await expect(
      runRemoval({
        directory,
        run: () => {
          duplicateRan = true;
          return Promise.resolve();
        },
      }),
    ).rejects.toThrow('already being held');
    expect(duplicateRan).toBe(false);
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
    // Advance the real filesystem lease past its expiry after the owning process died.
    await utimes(`${directory}.removal.json.lock`, new Date(0), new Date(0));
    expect((await removalStatus(directory))?.running).toBe(false);
    await runRemoval({ directory, run: async () => {} });
    expect(await removalStatus(directory)).toBeUndefined();
    expect(existsSync(`${directory}.removal.json.lock`)).toBe(false);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      await exited;
    }
    await rm(root, { recursive: true, force: true });
  }
});

test('failed cleanup releases its lease and remains retryable without leaking upstream errors', async () => {
  const root = await mkdtemp(join(tmpdir(), 'context-use-removal-'));
  const directory = join(root, 'connection');
  try {
    await writeFile(`${directory}.removal.json`, '{}');
    await expect(
      runRemoval({
        directory,
        run: () => Promise.reject(new Error('secret response')),
      }),
    ).rejects.toThrow();
    expect(await removalStatus(directory)).toEqual({
      running: false,
      error: 'Removal failed. Run remove again to resume cleanup.',
    });
    await runRemoval({ directory, run: async () => {} });
    expect(await removalStatus(directory)).toBeUndefined();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test(
  'the removal worker restores local settings and releases reconnect even when gateway authorization fails',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'context-use-local-removal-'));
    const directory = join(root, 'plugins', 'context-use');
    const configPath = join(root, 'openclaw.json');
    try {
      const bin = join(root, 'bin');
      await mkdir(bin);
      const command = join(bin, 'openclaw');
      await writeFile(
        command,
        `#!/bin/sh
case "$*" in
  'config file --json') echo '{"path":"/fixture/openclaw.json"}' ;;
  *config.get*) echo '{"error":{"type":"gateway_auth_error","message":"token mismatch"}}'; exit 1 ;;
  'plugins uninstall context-use --force') exit 0 ;;
  *) exit 2 ;;
esac
`,
      );
      const executableMode = 0o700;
      await chmod(command, executableMode);
      await writeFile(
        configPath,
        JSON.stringify({
          plugins: {
            entries: { 'memory-core': { enabled: false }, 'context-use': { enabled: false } },
          },
        }),
      );
      await writeState({
        directory,
        state: {
          config: { agentId: 'main', serverUrl: 'https://memory.example/mcp' },
          changes: [{ path: ['plugins', 'entries', 'memory-core', 'enabled'], applied: false }],
          oauth: { tokens: { access_token: 'discard', token_type: 'Bearer' } },
          tools: [],
        },
      });
      await writeFile(join(directory, 'pending-evidence'), 'discard');
      await writeFile(`${directory}.removal.json`, '{}');
      const child = Bun.spawn(
        [process.execPath, resolve(import.meta.dir, '../src/remove-worker.ts')],
        {
          env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH}`,
            OPENCLAW_STATE_DIR: root,
            OPENCLAW_CONFIG_PATH: configPath,
          },
          stdout: 'pipe',
          stderr: 'pipe',
        },
      );
      expect(await child.exited).toBe(0);
      const config = JSON.parse(await readFile(configPath, 'utf8'));
      expect(config.plugins?.entries?.['memory-core']?.enabled).toBeUndefined();
      expect(config.plugins?.entries?.['context-use']).toEqual({ enabled: false });
      expect(existsSync(directory)).toBe(false);
      expect(await removalStatus(directory)).toBeUndefined();
      expect(existsSync(`${directory}.removal.json.lock`)).toBe(false);
      await expect(assertNotRemoving(directory)).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  WORKER_TEST_TIMEOUT_MS,
);
