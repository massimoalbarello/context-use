import type { Auth } from '#lib/auth/better-auth.ts';
import { OWNER_USER_ID } from '#lib/auth/owner-registration.ts';

export const DEMO_OWNER_ID = OWNER_USER_ID;

/** An explicit principal for the bundled public snapshot; never a persisted login session. */
export function createDemoIdentity(): Auth {
  const now = new Date();
  const session: NonNullable<Awaited<ReturnType<Auth['getSession']>>> = {
    user: {
      id: DEMO_OWNER_ID,
      name: 'Steve Jobs',
      email: 'steve-jobs@example.invalid',
      emailVerified: false,
      createdAt: now,
      updatedAt: now,
    },
    session: {
      id: 'public-steve-jobs-demo',
      userId: DEMO_OWNER_ID,
      token: 'public-demo-not-a-credential',
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date('9999-12-31T00:00:00Z'),
    },
  };
  return {
    getSession: () => Promise.resolve(session),
    handler: () => Promise.resolve(new Response(null, { status: 403 })),
    protectMcpRequest: () => () => Promise.resolve(new Response(null, { status: 403 })),
  };
}
