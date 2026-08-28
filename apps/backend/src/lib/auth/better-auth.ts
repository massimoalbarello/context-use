import { passkey } from '@better-auth/passkey';
import { bunSqlAdapter } from '@ilbertt/better-auth-bun-sql';
import { type BetterAuthOptions, betterAuth } from 'better-auth';
import { APIError, getAuthoritativeSessionFromCtx } from 'better-auth/api';
import type { SQL } from 'bun';
import type { OpenAPIV3 } from 'openapi-types';
import {
  authorizeOwnerPasskeyRegistration,
  OWNER_SYNTHETIC_EMAIL,
  OWNER_USER_ID,
  OwnerRegistrationError,
  ownerRegistrationUser,
} from '#lib/auth/owner-registration.ts';
import { RoutePrefix } from '#lib/routes/prefixes.ts';

export const AUTH_ROUTE_PATH = '/auth';

const BETTER_AUTH_API_BASE_PATH = `${RoutePrefix.Api}${AUTH_ROUTE_PATH}`;
const BETTER_AUTH_TABLES_PREFIX = 'auth_';
const PASSKEY_RELYING_PARTY_NAME = 'Context Use';

function ownerRegistrationApiError(error: unknown): never {
  if (!(error instanceof OwnerRegistrationError)) {
    throw error;
  }

  const status =
    error.code === 'invalid_owner_name'
      ? 'BAD_REQUEST'
      : error.code === 'owner_registration_state_invalid'
        ? 'INTERNAL_SERVER_ERROR'
        : error.code === 'user_verification_required'
          ? 'UNAUTHORIZED'
          : 'FORBIDDEN';
  throw APIError.from(status, { code: error.code, message: error.message });
}

export function createAuth({
  database,
  baseUrl,
  secret,
}: {
  database: SQL;
  baseUrl: URL;
  secret: string;
}) {
  const authOptions: BetterAuthOptions = {
    database: bunSqlAdapter({ sql: database, tablesPrefix: BETTER_AUTH_TABLES_PREFIX }),
    // The origin, never the href: better-auth drops `basePath` entirely when the base URL already
    // carries a path, so a `BASE_URL` with one would silently move every auth route. Its origin is
    // trusted automatically, which is why no `trustedOrigins` is needed.
    baseURL: baseUrl.origin,
    basePath: BETTER_AUTH_API_BASE_PATH,
    secret,
    plugins: [
      passkey({
        rpID: baseUrl.hostname,
        rpName: PASSKEY_RELYING_PARTY_NAME,
        origin: baseUrl.origin,
        authenticatorSelection: {
          residentKey: 'required',
          userVerification: 'required',
        },
        registration: {
          requireSession: false,
          resolveUser: async ({ ctx, context }) => {
            try {
              const owner = await ctx.context.internalAdapter.findUserById(OWNER_USER_ID);
              return ownerRegistrationUser({ context, ownerExists: Boolean(owner) });
            } catch (error) {
              return ownerRegistrationApiError(error);
            }
          },
          afterVerification: async ({ ctx, verification, user, context }) => {
            try {
              if (user.id !== OWNER_USER_ID) {
                throw new OwnerRegistrationError('owner_registration_state_invalid');
              }

              const owner = await ctx.context.internalAdapter.findUserById(OWNER_USER_ID);
              const session = await getAuthoritativeSessionFromCtx(ctx);
              const action = authorizeOwnerPasskeyRegistration({
                ownerExists: Boolean(owner),
                sessionUserId: session?.user.id,
                userVerified: verification.registrationInfo?.userVerified === true,
              });

              if (action === 'create-owner') {
                const { displayName } = ownerRegistrationUser({ context, ownerExists: false });
                await ctx.context.internalAdapter.createUser(
                  {
                    id: OWNER_USER_ID,
                    name: displayName,
                    email: OWNER_SYNTHETIC_EMAIL,
                    emailVerified: true,
                  },
                  { method: 'passkey' },
                );
              }

              return { userId: OWNER_USER_ID };
            } catch (error) {
              return ownerRegistrationApiError(error);
            }
          },
        },
        authentication: {
          afterVerification: ({ verification }) => {
            if (verification.authenticationInfo.userVerified !== true) {
              throw APIError.from('UNAUTHORIZED', {
                code: 'user_verification_required',
                message: 'Your authenticator must verify that it is you.',
              });
            }
          },
        },
      }),
    ],
    advanced: {
      database: {
        generateId: () => Bun.randomUUIDv7(),
      },
    },
  };
  const auth = betterAuth(authOptions);

  return {
    handler(request: Request) {
      return auth.handler(request);
    },
    async getSession({ headers }: { headers: Headers }) {
      return await auth.api.getSession({ headers });
    },
  };
}

export type Auth = ReturnType<typeof createAuth>;

export const SESSION_SECURITY_SCHEME = 'betterAuthSession';

export const sessionSecuritySchemes = {
  [SESSION_SECURITY_SCHEME]: {
    type: 'apiKey',
    in: 'cookie',
    // better-auth's default cookie name. The docs page sends whatever is named here, so a
    // renamed cookie has to be renamed here too or "Authorize" silently authorizes nothing.
    name: 'better-auth.session_token',
    description: 'Session cookie set by signing in.',
  },
} satisfies Record<string, OpenAPIV3.SecuritySchemeObject>;
