import { authorizeMcp, registerOwner } from './auth';
import { virtualPasskeyBrowser } from './browser';

export async function ownerBrowser(origin: string) {
  const browser = await virtualPasskeyBrowser({ headless: true });
  try {
    await registerOwner({ page: browser.page, origin });
    return {
      page: browser.page,
      close: browser.close,
      authorize: (input: Omit<Parameters<typeof authorizeMcp>[0], 'page'>) =>
        authorizeMcp({ ...input, page: browser.page }),
    };
  } catch (error) {
    await browser.close();
    throw error;
  }
}
