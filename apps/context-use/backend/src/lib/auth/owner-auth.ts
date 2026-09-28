import type { Auth } from './better-auth.ts';
import { OWNER_USER_ID } from './owner-registration.ts';

export function createOwnerAuth(auth: Auth): Auth {
  return {
    ...auth,
    async getSession(input) {
      const session = await auth.getSession(input);
      return session?.user.id === OWNER_USER_ID ? session : null;
    },
  };
}
