import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { type Browser, chromium, type Page } from 'playwright';

const TEST_TIMEOUT_MS = 240_000;
const START_TIMEOUT_MS = 180_000;
const STOP_TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 100;
const root = resolve(import.meta.dir, '../../..');

type Session = {
  pid: number;
  appUrl: string;
  backendPort: number;
  dataFolder: string;
  targetId: string;
  BU_NAME: string;
  BU_CDP_URL: string;
};

function startSession(dataFolder: string) {
  let output = '';
  const child = Bun.spawn(['bun', 'run', 'dev:isolated:seeded'], {
    cwd: root,
    env: { ...process.env, DATA_FOLDER: dataFolder },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const capture = async (stream: ReadableStream<Uint8Array>) => {
    for await (const chunk of stream) {
      output += new TextDecoder().decode(chunk);
    }
  };
  const drained = Promise.all([capture(child.stdout), capture(child.stderr)]);
  const session = () => {
    const match = output.match(/Isolated browser session: (\{[^\n]+\})/);
    return match ? (JSON.parse(match[1]!) as Session) : undefined;
  };
  return {
    child,
    output: () => output,
    session,
    waitFor: async (message: string) => {
      const deadline = Date.now() + START_TIMEOUT_MS;
      while (Date.now() < deadline && child.exitCode === null) {
        if (output.includes(message)) {
          return session()!;
        }
        await Bun.sleep(POLL_INTERVAL_MS);
      }
      throw new Error(`Session failed to become ready:\n${output}`);
    },
    stop: async () => {
      if (child.exitCode === null) {
        const pid = session()?.pid;
        if (pid) {
          process.kill(pid, 'SIGTERM');
        } else {
          child.kill('SIGTERM');
        }
      }
      await Promise.race([
        child.exited,
        Bun.sleep(STOP_TIMEOUT_MS).then(() => {
          throw new Error(`Session did not stop:\n${output}`);
        }),
      ]);
      await drained;
    },
  };
}

async function expectClosed(session: Session) {
  expect(existsSync(session.dataFolder)).toBe(false);
  for (const port of [session.backendPort, new URL(session.appUrl).port]) {
    expect(existsSync(join(tmpdir(), `context-use-isolated-port-${port}`))).toBe(false);
  }
  for (const origin of [
    session.appUrl,
    `http://localhost:${session.backendPort}`,
    session.BU_CDP_URL,
  ]) {
    await expect(fetch(origin, { signal: AbortSignal.timeout(STOP_TIMEOUT_MS) })).rejects.toThrow();
  }
}

async function ownedPage(input: { browser: Browser; session: Session }): Promise<Page> {
  for (const page of input.browser.contexts()[0]!.pages()) {
    const cdp = await page.context().newCDPSession(page);
    const { targetInfo } = await cdp.send('Target.getTargetInfo');
    await cdp.detach();
    if (targetInfo.targetId === input.session.targetId) {
      return page;
    }
  }
  throw new Error('The session tab was not found in its browser');
}

test(
  'concurrent seeded sessions own their ports, browser tabs and shutdown',
  async () => {
    const ordinaryData = await mkdtemp(join(tmpdir(), 'context-use-ordinary-test-'));
    const sentinel = join(ordinaryData, 'preserve-me');
    await Bun.write(sentinel, 'ordinary developer data');
    const first = startSession(ordinaryData);
    const second = startSession(ordinaryData);
    const connections: Awaited<ReturnType<typeof chromium.connectOverCDP>>[] = [];
    const pages: Page[] = [];
    try {
      const [a, b] = await Promise.all([
        first.waitFor('Virtual passkey ready at'),
        second.waitFor('Virtual passkey ready at'),
      ]);
      expect(new Set([a.appUrl, b.appUrl]).size).toBe(2);
      expect(a.backendPort).not.toBe(b.backendPort);
      expect(a.BU_CDP_URL).not.toBe(b.BU_CDP_URL);
      expect(a.BU_NAME).not.toBe(b.BU_NAME);
      expect(a.targetId).not.toBe(b.targetId);
      expect(a.dataFolder).not.toBe(b.dataFolder);
      for (const session of [a, b]) {
        const browser = await chromium.connectOverCDP(session.BU_CDP_URL);
        connections.push(browser);
        const page = await ownedPage({ browser, session });
        pages.push(page);
        expect(page.url()).toBe(`${session.appUrl}/app/map`);
        // A real DOM interaction verifies that each seeded browser owns a usable app.
        await page.getByRole('button', { name: 'Open sidebar', exact: true }).click();
        await page.getByRole('link', { name: 'Pages', exact: true }).click();
        await page.waitForURL('**/app/pages');
        expect(await page.locator('body').innerText()).toContain('Steve Jobs');
      }
      // Closing one run's tab shuts its browser and servers without affecting its peer.
      await pages[0]!.close();
      await first.child.exited;
      expect(first.child.exitCode).toBe(0);
      await expectClosed(a);
      expect((await fetch(new URL('/api/health', b.appUrl))).ok).toBe(true);
      await pages[1]!.reload();
      expect(connections[1]!.isConnected()).toBe(true);
      await second.stop();
      const terminatedExitCode = 143;
      expect(second.child.exitCode).toBe(terminatedExitCode);
      await expectClosed(b);
      expect(await Bun.file(sentinel).text()).toBe('ordinary developer data');
    } finally {
      await Promise.allSettled(connections.map((browser) => browser.close()));
      await Promise.all([first.stop(), second.stop()]);
      await rm(ordinaryData, { recursive: true, force: true });
    }
  },
  TEST_TIMEOUT_MS,
);

test(
  'stopping during registration cleans up the unfinished session',
  async () => {
    const run = startSession(join(tmpdir(), 'unused-ordinary-data'));
    try {
      const session = await run.waitFor('Isolated browser session:');
      await run.stop();
      expect(run.output()).not.toContain('Virtual passkey ready at');
      await expectClosed(session);
    } finally {
      await run.stop();
    }
  },
  TEST_TIMEOUT_MS,
);
