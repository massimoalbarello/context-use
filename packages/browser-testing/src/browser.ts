import { chromium } from 'playwright';
import { enableVirtualPasskey } from './auth';

const BROWSER_TIMEOUT_MS = 90_000;
const SESSION_ID_LENGTH = 8;

function availablePort(): number {
  const listener = Bun.serve({ port: 0, fetch: () => new Response() });
  const port = listener.port!;
  listener.stop(true);
  return port;
}

export async function virtualPasskeyBrowser(input: { headless: boolean }) {
  const port = availablePort();
  const context = await chromium.launchPersistentContext('', {
    channel: 'chrome',
    headless: input.headless,
    // The caller owns process shutdown and must finish deleting disposable app
    // state; Playwright's SIGINT handler would exit before its finally block.
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
    args: [`--remote-debugging-port=${port}`],
  });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    page.setDefaultTimeout(BROWSER_TIMEOUT_MS);
    page.setDefaultNavigationTimeout(BROWSER_TIMEOUT_MS);
    await enableVirtualPasskey(page);
    const cdp = await context.newCDPSession(page);
    const { targetInfo } = await cdp.send('Target.getTargetInfo');
    return {
      page,
      targetId: targetInfo.targetId,
      harnessEnv: {
        BU_NAME: `cu-${crypto.randomUUID().slice(0, SESSION_ID_LENGTH)}`,
        BU_CDP_URL: `http://127.0.0.1:${port}`,
        BH_RECORD: '0',
      },
      close: () => context.close(),
    };
  } catch (error) {
    await context.close();
    throw error;
  }
}
