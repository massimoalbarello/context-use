import { oauthProvider } from "@better-auth/oauth-provider";
import { passkey } from "@better-auth/passkey";
import { APIError, betterAuth, type BetterAuthPlugin } from "better-auth";
import { jwt } from "better-auth/plugins";
import { MCP_SCOPES } from "@context-use/shared";
import { createHash } from "node:crypto";
import { Pool } from "pg";
import { config, production } from "./config.ts";
import {
  isVerifiedOwner,
  normalizedOwnerEmail,
  ownerSetupContext,
  ownerUserId,
} from "./owner.ts";
import {
  consumeEnrollmentContext,
  enrollmentForContext,
  parseEnrollmentContext,
  passkeyLabelSchema,
} from "./passkey-management.ts";

const OAUTH_SCOPES = ["openid", "email", "offline_access", ...MCP_SCOPES];
const NANGO_OAUTH_SCOPES = ["openid", "email"] as const;
const NANGO_CLIENT_KIND = "context-use:nango-dashboard";

export const nangoOAuthRedirectUri = `${config.NANGO_ORIGIN}/_context-use-auth/callback`;

function hashOAuthClientSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("base64url");
}

export const authPool = new Pool({
  connectionString: config.AUTH_DATABASE_URL,
  max: 10,
  application_name: "context-use-auth",
});

let nangoClientProvisioning: Promise<void> | null = null;

async function provisionNangoOAuthClient(): Promise<void> {
  const now = new Date();
  const client = await authPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [NANGO_CLIENT_KIND]);
    await client.query(
      `UPDATE "oauthClient"
       SET disabled=true,"updatedAt"=$3
       WHERE "referenceId"=$1 AND "clientId"<>$2`,
      [NANGO_CLIENT_KIND, config.NANGO_OAUTH_CLIENT_ID, now],
    );
    await client.query(
      `INSERT INTO "oauthClient"(
       id,"clientId","clientSecret",disabled,"skipConsent","enableEndSession",
       "subjectType",scopes,"userId","createdAt","updatedAt",name,uri,
       "redirectUris","postLogoutRedirectUris","tokenEndpointAuthMethod",
       "grantTypes","responseTypes",public,type,"requirePKCE","referenceId",
       metadata,"dpopBoundAccessTokens"
     ) VALUES (
       $1,$2,$3,false,true,false,'public',$4::jsonb,NULL,$5,$5,
       'context-use Nango dashboard',$6,$7::jsonb,'[]'::jsonb,
       'client_secret_basic','["authorization_code"]'::jsonb,'["code"]'::jsonb,
       false,'web',true,$8,$9::jsonb,false
     )
     ON CONFLICT ("clientId") DO UPDATE SET
       "clientSecret"=excluded."clientSecret",
       disabled=false,
       "skipConsent"=true,
       "enableEndSession"=false,
       "subjectType"='public',
       scopes=excluded.scopes,
       "userId"=NULL,
       "updatedAt"=excluded."updatedAt",
       name=excluded.name,
       uri=excluded.uri,
       "redirectUris"=excluded."redirectUris",
       "postLogoutRedirectUris"='[]'::jsonb,
       "tokenEndpointAuthMethod"='client_secret_basic',
       "grantTypes"='["authorization_code"]'::jsonb,
       "responseTypes"='["code"]'::jsonb,
       public=false,
       type='web',
       "requirePKCE"=true,
       "referenceId"=excluded."referenceId",
       metadata=excluded.metadata,
       "dpopBoundAccessTokens"=false`,
      [
        `first-party:${config.NANGO_OAUTH_CLIENT_ID}`,
        config.NANGO_OAUTH_CLIENT_ID,
        hashOAuthClientSecret(config.NANGO_OAUTH_CLIENT_SECRET),
        JSON.stringify(NANGO_OAUTH_SCOPES),
        now,
        config.NANGO_ORIGIN,
        JSON.stringify([nangoOAuthRedirectUri]),
        NANGO_CLIENT_KIND,
        JSON.stringify({ client_kind: NANGO_CLIENT_KIND }),
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function ensureNangoOAuthClient(): Promise<void> {
  if (!nangoClientProvisioning) {
    nangoClientProvisioning = provisionNangoOAuthClient().catch((error) => {
      nangoClientProvisioning = null;
      throw error;
    });
  }
  await nangoClientProvisioning;
}

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

async function resolvePasskeyRegistration(context: string | null | undefined) {
  const existing = await authPool.query("SELECT 1 FROM passkey WHERE \"userId\"=$1 LIMIT 1", [ownerUserId]);
  if (!existing.rowCount) return resolveOwnerSetup(context);
  const enrollment = await enrollmentForContext(authPool, context);
  if (!enrollment) throw new APIError("FORBIDDEN", { message: "A confirmed passkey enrollment is required" });
  return {
    id: ownerUserId,
    name: normalizedOwnerEmail,
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
        resolveUser: ({ context }) => resolvePasskeyRegistration(context),
        afterVerification: async ({ context, ctx, verification }) => {
          if (!verification.registrationInfo?.userVerified) {
            throw new APIError("FORBIDDEN", { message: "User verification is required" });
          }
          if (parseEnrollmentContext(context)) {
            const expectedEnrollment = await enrollmentForContext(authPool, context);
            const requestedName = typeof ctx.body?.name === "string" ? ctx.body.name.trim() : "";
            if (!expectedEnrollment || (requestedName && requestedName !== expectedEnrollment.name)) {
              throw new APIError("FORBIDDEN", { message: "Passkey enrollment details do not match" });
            }
            const enrollment = await consumeEnrollmentContext(authPool, context);
            if (!enrollment) {
              throw new APIError("CONFLICT", { message: "The passkey enrollment is expired or already used" });
            }
            await createOwner();
            return { userId: ownerUserId, name: enrollment.name };
          }
          await resolveOwnerSetup(context);
          await createOwner();
          const requestedName = typeof ctx.body?.name === "string" ? ctx.body.name.trim() : "";
          if (requestedName && !passkeyLabelSchema.safeParse(requestedName).success) {
            throw new APIError("BAD_REQUEST", { message: "Passkey names must be between 1 and 80 characters" });
          }
          return { userId: ownerUserId, name: requestedName || "Primary passkey" };
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
        name: "context-use knowledge MCP",
        accessTokenTtl: 900,
        refreshTokenTtl: 2_592_000,
        allowedScopes: OAUTH_SCOPES,
      }],
      resourceSeedMode: "overwrite",
      enforcePerClientResources: false,
      grantTypes: ["authorization_code", "refresh_token"],
      accessTokenExpiresIn: 900,
      refreshTokenExpiresIn: 2_592_000,
      // MCP clients can have multiple runtimes retry the same refresh after a
      // reconnect. Replay the completed rotation briefly instead of treating
      // that retry as token theft and invalidating the whole token family.
      refreshTokenReuseInterval: 30,
      storeClientSecret: { hash: hashOAuthClientSecret },
      codeExpiresIn: 300,
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      clientRegistrationDefaultScopes: [...MCP_SCOPES],
      clientRegistrationAllowedScopes: ["offline_access", "openid"],
      clientRegistrationClientSecretExpiration: "30 days",
      silenceWarnings: { oauthAuthServerConfig: true, openidConfig: true },
      customAccessTokenClaims: ({ metadata, scopes }) => ({
        principal_type: metadata?.client_kind === NANGO_CLIENT_KIND
          && NANGO_OAUTH_SCOPES.every((scope) => scopes.includes(scope))
          && scopes.length === NANGO_OAUTH_SCOPES.length
          ? "nango_dashboard_owner"
          : "mcp_agent",
      }),
      // The provider keeps the standard profile claims out of the ID token and
      // serves them from UserInfo instead. OAuth2 Proxy guards the Nango edge
      // with SKIP_CLAIMS_FROM_PROFILE_URL so it never calls UserInfo, and it
      // refuses to create a session without a verified email, so carry both
      // claims in the ID token for the clients granted the email scope.
      customIdTokenClaims: ({ user, scopes }) => scopes.includes("email")
        ? { email: user.email, email_verified: user.emailVerified === true }
        : {},
      clientPrivileges: ({ user }) => user?.id === ownerUserId && isVerifiedOwner(user.email, user.emailVerified) ? true : undefined,
    }) as unknown as BetterAuthPlugin,
  ],
});

export type DashboardPrincipal = {
  userId: string;
  sessionId: string;
  email: string;
};

export async function touchLiveOwnerSession(sessionId: string): Promise<boolean> {
  if (!sessionId || sessionId.length > 512) return false;
  const touched = await authPool.query(
    `UPDATE "session"
     SET "updatedAt"=now()
     WHERE id=$1 AND "userId"=$2
       AND "createdAt">=now()-make_interval(secs=>$3::int)
       AND "updatedAt">=now()-make_interval(secs=>$4::int)
       AND "expiresAt">now()
       AND EXISTS (
         SELECT 1 FROM "user" owner
         WHERE owner.id=$2
           AND lower(btrim(owner.email))=$5
           AND owner."emailVerified"=true
       )
     RETURNING id`,
    [sessionId, ownerUserId, config.SESSION_MAX_SECONDS, config.SESSION_IDLE_SECONDS, normalizedOwnerEmail],
  );
  return Boolean(touched.rowCount);
}

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
  if (!await touchLiveOwnerSession(result.session.id)) return null;
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
