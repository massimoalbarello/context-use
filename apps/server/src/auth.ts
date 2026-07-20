import { oauthProvider } from "@better-auth/oauth-provider";
import { passkey } from "@better-auth/passkey";
import { APIError, betterAuth, type BetterAuthPlugin } from "better-auth";
import { jwt } from "better-auth/plugins";
import { MCP_SCOPES } from "@context-use/shared";
import { Pool } from "pg";
import { config, production } from "./config.ts";
import {
  isVerifiedOwner,
  normalizedOwnerEmail,
  ownerSetupContext,
  ownerUserId,
} from "./owner.ts";

const OAUTH_SCOPES = ["openid", "offline_access", ...MCP_SCOPES];

export const authPool = new Pool({
  connectionString: config.AUTH_DATABASE_URL,
  max: 10,
  application_name: "context-use-auth",
});

async function resolveOwnerSetup(context: string | null | undefined) {
  const setup = ownerSetupContext(context);
  if (!setup) throw new APIError("FORBIDDEN", { message: "Invalid owner setup claim" });
  const existing = await authPool.query("SELECT 1 FROM passkey LIMIT 1");
  if (existing.rowCount) throw new APIError("CONFLICT", { message: "The owner passkey is already registered" });
  return {
    id: ownerUserId,
    name: setup.email,
    displayName: "context-use owner",
  };
}

async function createOwner(): Promise<void> {
  try {
    await authPool.query(
      `INSERT INTO "user"(id,name,email,"emailVerified") VALUES ($1,'Owner',$2,true)
       ON CONFLICT (id) DO NOTHING`,
      [ownerUserId, normalizedOwnerEmail],
    );
  } catch (error) {
    throw new APIError("CONFLICT", { message: "The owner identity could not be created", cause: error });
  }
  const owner = await authPool.query<{ email: string; emailVerified: boolean }>(
    `SELECT email,"emailVerified" FROM "user" WHERE id=$1`,
    [ownerUserId],
  );
  if (!owner.rows[0] || !isVerifiedOwner(owner.rows[0].email, owner.rows[0].emailVerified)) {
    throw new APIError("FORBIDDEN", { message: "The owner identity does not match this installation" });
  }
}

export const auth = betterAuth({
  appName: "context-use",
  baseURL: config.APP_ORIGIN,
  basePath: "/api/auth",
  secret: config.BETTER_AUTH_SECRET,
  database: authPool,
  telemetry: { enabled: false },
  trustedOrigins: [config.APP_ORIGIN],
  session: {
    expiresIn: config.SESSION_MAX_SECONDS,
    updateAge: 3_600,
    // Better Auth's default refresh is sliding and mutates updatedAt before an
    // application policy can inspect it. Context Use keeps expiry absolute and
    // advances activity only after its own idle/owner checks succeed.
    disableSessionRefresh: true,
    cookieCache: { enabled: false },
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 60,
    customRules: {
      "/passkey/generate-register-options": { window: 60, max: 10 },
      "/passkey/verify-registration": { window: 60, max: 10 },
      "/passkey/generate-authenticate-options": { window: 60, max: 20 },
      "/passkey/verify-authentication": { window: 60, max: 20 },
      "/oauth2/register": { window: 60, max: 10 },
      "/oauth2/token": { window: 60, max: 30 },
    },
  },
  advanced: {
    useSecureCookies: production,
    cookiePrefix: production ? "__Host-context-use" : "context-use",
    defaultCookieAttributes: {
      httpOnly: true,
      secure: production,
      sameSite: "lax",
      path: "/",
    },
    crossSubDomainCookies: { enabled: false },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          if (user.id !== ownerUserId || !isVerifiedOwner(user.email, user.emailVerified)) {
            throw new APIError("FORBIDDEN", { message: "This installation accepts only its configured owner" });
          }
          return { data: { ...user, email: normalizedOwnerEmail, emailVerified: true } };
        },
      },
      update: {
        before: async (user) => {
          if (user.email !== undefined && user.email.trim().toLowerCase() !== normalizedOwnerEmail) {
            throw new APIError("FORBIDDEN", { message: "The owner identity cannot be changed" });
          }
        },
      },
    },
  },
  plugins: [
    jwt({
      disableSettingJwtHeader: true,
      jwks: {
        keyPairConfig: { alg: "EdDSA", crv: "Ed25519" },
        rotationInterval: 2_592_000,
        gracePeriod: 2_592_000,
      },
      jwt: {
        issuer: config.OAUTH_ISSUER,
        audience: config.MCP_RESOURCE,
        expirationTime: "15m",
      },
    }),
    passkey({
      rpID: config.WEBAUTHN_RP_ID,
      rpName: config.WEBAUTHN_RP_NAME,
      origin: config.APP_ORIGIN,
      authenticatorSelection: {
        residentKey: "required",
        requireResidentKey: true,
        userVerification: "required",
      },
      registration: {
        requireSession: false,
        resolveUser: ({ context }) => resolveOwnerSetup(context),
        afterVerification: async ({ context, verification }) => {
          if (!verification.registrationInfo?.userVerified) {
            throw new APIError("FORBIDDEN", { message: "User verification is required" });
          }
          await resolveOwnerSetup(context);
          await createOwner();
          return { userId: ownerUserId, name: "Owner passkey" };
        },
      },
      authentication: {
        afterVerification: ({ verification }) => {
          if (!verification.authenticationInfo.userVerified) {
            throw new APIError("FORBIDDEN", { message: "User verification is required" });
          }
        },
      },
    }),
    oauthProvider({
      loginPage: "/app/login",
      consentPage: "/app/oauth/consent",
      scopes: OAUTH_SCOPES,
      resources: [{
        identifier: config.MCP_RESOURCE,
        name: "context-use MCP",
        accessTokenTtl: 900,
        refreshTokenTtl: 2_592_000,
        allowedScopes: OAUTH_SCOPES,
      }],
      resourceSeedMode: "overwrite",
      enforcePerClientResources: false,
      grantTypes: ["authorization_code", "refresh_token"],
      accessTokenExpiresIn: 900,
      refreshTokenExpiresIn: 2_592_000,
      codeExpiresIn: 300,
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      clientRegistrationDefaultScopes: [...MCP_SCOPES],
      clientRegistrationAllowedScopes: ["offline_access", "openid"],
      clientRegistrationClientSecretExpiration: "30 days",
      silenceWarnings: { oauthAuthServerConfig: true, openidConfig: true },
      customAccessTokenClaims: () => ({
        principal_type: "mcp_agent",
      }),
      clientPrivileges: ({ user }) => user?.id === ownerUserId && isVerifiedOwner(user.email, user.emailVerified) ? true : undefined,
    }) as unknown as BetterAuthPlugin,
  ],
});

export type DashboardPrincipal = {
  userId: string;
  sessionId: string;
  email: string;
};

export async function dashboardPrincipal(request: Request): Promise<DashboardPrincipal | null> {
  if (request.headers.has("authorization")) return null;
  const result = await auth.api.getSession({
    headers: request.headers,
    query: { disableCookieCache: true, disableRefresh: true },
  });
  if (!result || result.user.id !== ownerUserId || !isVerifiedOwner(result.user.email, result.user.emailVerified)) return null;

  const createdAt = new Date(result.session.createdAt).getTime();
  const updatedAt = new Date(result.session.updatedAt).getTime();
  const expiresAt = new Date(result.session.expiresAt).getTime();
  const now = Date.now();
  if (now - createdAt > config.SESSION_MAX_SECONDS * 1_000) return null;
  if (now - updatedAt > config.SESSION_IDLE_SECONDS * 1_000) return null;
  if (expiresAt <= now) return null;

  // Recheck every bound in the write itself. Concurrent requests cannot revive
  // a session that crossed the idle/absolute boundary after the read above,
  // and expiresAt is never extended.
  const touched = await authPool.query(
    `UPDATE "session"
     SET "updatedAt"=now()
     WHERE id=$1 AND "userId"=$2
       AND "createdAt">=now()-make_interval(secs=>$3::int)
       AND "updatedAt">=now()-make_interval(secs=>$4::int)
       AND "expiresAt">now()
     RETURNING id`,
    [result.session.id, ownerUserId, config.SESSION_MAX_SECONDS, config.SESSION_IDLE_SECONDS],
  );
  if (!touched.rowCount) return null;
  return {
    userId: result.user.id,
    sessionId: result.session.id,
    email: result.user.email,
  };
}

const OWNER_SESSION_AUTH_PATHS = new Set([
  "/api/auth/oauth2/consent",
  "/api/auth/oauth2/continue",
]);

export function authPathRequiresOwnerSession(pathname: string): boolean {
  return OWNER_SESSION_AUTH_PATHS.has(pathname);
}
