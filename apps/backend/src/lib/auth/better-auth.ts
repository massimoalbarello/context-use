import type { CimdOptions } from '@better-auth/cimd';
import { cimd } from '@better-auth/cimd';
import { mcp, requireMcpAuth } from '@better-auth/mcp';
import { passkey } from '@better-auth/passkey';
import { bunSqlAdapter } from '@ilbertt/better-auth-bun-sql';
import { type BetterAuthOptions, betterAuth } from 'better-auth';
import { APIError, getAuthoritativeSessionFromCtx } from 'better-auth/api';
import { jwt } from 'better-auth/plugins';
import type { SQL } from 'bun';
import type { OpenAPIV3 } from 'openapi-types';
import { API_PATH } from '#lib/api-path.ts';
import {
  authorizeOwnerPasskeyRegistration,
  OWNER_DISPLAY_NAME,
  OWNER_SYNTHETIC_EMAIL,
  OWNER_USER_ID,
  OwnerRegistrationError,
  ownerRegistrationUser,
} from '#lib/auth/owner-registration.ts';

export const AUTH_ROUTE_PATH = '/auth';
export const MCP_ROUTE_PATH = '/mcp';
export const MCP_SCOPE = 'mcp';

export function mcpServerUrl({ baseUrl }: { baseUrl: URL }): string {
  return new URL(MCP_ROUTE_PATH, baseUrl.origin).href;
}

const ACCESS_TOKEN_LIFETIME_SECONDS = 300;
const REFRESH_TOKEN_LIFETIME_SECONDS = 315_360_000;
const REFRESH_TOKEN_RETRY_SECONDS = 30;

const BETTER_AUTH_API_BASE_PATH = `${API_PATH}${AUTH_ROUTE_PATH}`;
const BETTER_AUTH_TABLES_PREFIX = 'auth_';
const PASSKEY_RELYING_PARTY_NAME = 'Context Use';

function ownerRegistrationApiError(error: unknown): never {
  if (!(error instanceof OwnerRegistrationError)) {
    throw error;
  }

  const status =
    error.code === 'owner_registration_state_invalid'
      ? 'INTERNAL_SERVER_ERROR'
      : error.code === 'user_verification_required'
        ? 'UNAUTHORIZED'
        : 'FORBIDDEN';
  throw APIError.from(status, { code: error.code, message: error.message });
}

export function createAuthOptions({
  database,
  baseUrl,
  secret,
  fetchClientMetadataResource,
}: {
  database: SQL;
  baseUrl: URL;
  secret: string;
  fetchClientMetadataResource: CimdOptions['fetchClientMetadataResource'];
}): BetterAuthOptions {
  const mcpResource = mcpServerUrl({ baseUrl });
  return {
    database: bunSqlAdapter({ sql: database, tablesPrefix: BETTER_AUTH_TABLES_PREFIX }),
    // The origin, never the href: better-auth drops `basePath` entirely when the base URL already
    // carries a path, so a `BASE_URL` with one would silently move every auth route. Its origin is
    // trusted automatically, which is why no `trustedOrigins` is needed.
    baseURL: baseUrl.origin,
    basePath: BETTER_AUTH_API_BASE_PATH,
    secret,
    plugins: [
      jwt(),
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
          resolveUser: async ({ ctx }) => {
            try {
              const owner = await ctx.context.internalAdapter.findUserById(OWNER_USER_ID);
              return ownerRegistrationUser({ ownerExists: Boolean(owner) });
            } catch (error) {
              return ownerRegistrationApiError(error);
            }
          },
          afterVerification: async ({ ctx, verification, user }) => {
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
                await ctx.context.internalAdapter.createUser(
                  {
                    id: OWNER_USER_ID,
                    name: OWNER_DISPLAY_NAME,
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
      mcp({
        resource: mcpResource,
        loginPage: '/login',
        consentPage: '/mcp/authorize',
        scopes: [MCP_SCOPE, 'offline_access'],
        accessTokenExpiresIn: ACCESS_TOKEN_LIFETIME_SECONDS,
        // Rotation renews this finite provider window. Ten years preserves the product contract
        // for idle clients without introducing an unbounded, unrotated bearer credential.
        refreshTokenExpiresIn: REFRESH_TOKEN_LIFETIME_SECONDS,
        refreshTokenReuseInterval: REFRESH_TOKEN_RETRY_SECONDS,
        clientRegistrationDefaultScopes: [MCP_SCOPE, 'offline_access'],
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
      }),
      cimd({
        fetchClientMetadataResource,
        metadataProfile: 'mcp-2026-07-28',
      }),
    ],
    advanced: {
      database: {
        generateId: () => Bun.randomUUIDv7(),
      },
    },
  };
}

export function createAuth(input: {
  database: SQL;
  baseUrl: URL;
  secret: string;
  fetchClientMetadataResource: CimdOptions['fetchClientMetadataResource'];
}) {
  const mcpResource = mcpServerUrl({ baseUrl: input.baseUrl });
  const auth = betterAuth(createAuthOptions(input));

  return {
    handler(request: Request) {
      return auth.handler(request);
    },
    async getSession({ headers }: { headers: Headers }) {
      return await auth.api.getSession({ headers });
    },
    protectMcpRequest({
      handler,
    }: {
      handler: (input: { request: Request; token: McpAccessToken }) => Promise<Response>;
    }) {
      return requireMcpAuth(auth, verifiedMcpRequestHandler({ handler, resource: mcpResource }), {
        resource: mcpResource,
        requiredScopes: [MCP_SCOPE],
        challengeScopes: [MCP_SCOPE, 'offline_access'],
      });
    },
  };
}

type VerifiedMcpRequestHandler = Parameters<typeof requireMcpAuth>[1];
type VerifiedMcpClaims = Parameters<VerifiedMcpRequestHandler>[1];

function stringClaim(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function mcpAccessToken({
  request,
  claims,
  resource,
}: {
  request: Request;
  claims: VerifiedMcpClaims;
  resource: string;
}): McpAccessToken | null {
  const ownerId = stringClaim(claims.sub);
  const oauthClientId = stringClaim(claims.client_id) ?? stringClaim(claims.azp);
  const expiresAt = typeof claims.exp === 'number' ? claims.exp : null;
  const scopes = stringClaim(claims.scope)?.split(' ') ?? [];
  const token = request.headers.get('authorization')?.replace(/^\S+\s+/, '') ?? '';
  return ownerId && oauthClientId && expiresAt && token
    ? { ownerId, oauthClientId, expiresAt, resource: new URL(resource), scopes, token }
    : null;
}

function verifiedMcpRequestHandler({
  handler,
  resource,
}: {
  handler: (input: { request: Request; token: McpAccessToken }) => Promise<Response>;
  resource: string;
}): VerifiedMcpRequestHandler {
  return (...parameters) => {
    const [request, claims] = parameters;
    const token = mcpAccessToken({ request, claims, resource });
    if (!token) {
      return new Response(JSON.stringify({ error: 'invalid_token' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    }
    return handler({ request, token });
  };
}

export type McpAccessToken = {
  ownerId: string;
  oauthClientId: string;
  expiresAt: number;
  resource: URL;
  scopes: string[];
  token: string;
};

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
