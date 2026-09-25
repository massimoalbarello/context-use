import type { Page } from 'playwright';

const AUTHORIZATION_TIMEOUT_MS = 180_000;

export async function enableVirtualPasskey(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable', { enableUI: false });
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      ctap2Version: 'ctap2_1',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      automaticPresenceSimulation: true,
      isUserVerified: true,
    },
  });
}

export async function registerOwner(input: { page: Page; origin: string }): Promise<void> {
  await input.page.goto(new URL('/app', input.origin).href, { waitUntil: 'domcontentloaded' });
  await input.page.getByRole('button', { name: 'Create account with a passkey' }).click();
  await input.page.waitForURL(/\/app\/setup\?/);
}

export async function authorizeMcp(input: {
  page: Page;
  authorizationUrl: string;
  callbackUrl: string;
  clientName: string;
}): Promise<string> {
  await input.page.goto(input.authorizationUrl, { waitUntil: 'domcontentloaded' });
  await input.page
    .getByRole('textbox', { name: 'Client name', exact: true })
    .fill(input.clientName);
  const redirect = input.page
    .waitForRequest(
      (request) =>
        request.isNavigationRequest() &&
        request.frame() === input.page.mainFrame() &&
        request.url().startsWith(`${input.callbackUrl}?`),
      {
        timeout: AUTHORIZATION_TIMEOUT_MS,
      },
    )
    .then(
      (request) => ({ url: request.url() }),
      (error: unknown) => ({ error }),
    );
  await input.page.getByRole('button', { name: 'Approve client' }).click();
  const result = await redirect;
  if ('error' in result) {
    throw result.error;
  }
  return result.url;
}
