import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type BrowserContext, chromium } from 'playwright';
import { enableVirtualPasskey } from './auth';

const BROWSER_TIMEOUT_MS = 90_000;

export async function virtualPasskeyBrowser(input: { headless: boolean }) {
  const profile = await mkdtemp(join(tmpdir(), 'context-use-browser-'));
  let context: BrowserContext | undefined;
  let closing: Promise<void> | undefined;
  const close = () => {
    closing ??= (async () => {
      try {
        await context?.close();
      } finally {
        await rm(profile, { recursive: true, force: true });
      }
    })();
    return closing;
  };
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chrome',
      headless: input.headless,
      viewport: input.headless ? undefined : null,
      // The caller owns process shutdown and must finish deleting disposable app
      // state; Playwright's SIGINT handler would exit before its finally block.
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
      args: ['--remote-debugging-port=0'],
    });
    const [port] = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n');
    const page = context.pages()[0] ?? (await context.newPage());
    const closed = new Promise<void>((resolve) => {
      context!.once('close', () => resolve());
      page.once('close', () => resolve());
    });
    page.setDefaultTimeout(BROWSER_TIMEOUT_MS);
    page.setDefaultNavigationTimeout(BROWSER_TIMEOUT_MS);
    await enableVirtualPasskey(page);
    const cdp = await context.newCDPSession(page);
    const { targetInfo } = await cdp.send('Target.getTargetInfo');
    return {
      page,
      targetId: targetInfo.targetId,
      harnessEnv: {
        BU_NAME: `cu-${crypto.randomUUID()}`,
        BU_CDP_URL: `http://127.0.0.1:${port}`,
        BH_RECORD: '0',
      },
      closed,
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
