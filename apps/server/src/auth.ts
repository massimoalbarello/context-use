import { oauthProvider } from "@better-auth/oauth-provider";
import { passkey } from "@better-auth/passkey";
import { APIError, betterAuth, type BetterAuthPlugin } from "better-auth";
import { jwt } from "better-auth/plugins";
import { Pool } from "pg";
import { config, production } from "./config.ts";
import { isVerifiedOwner, normalizedOwnerEmail } from "./owner.ts";

export const authPool = new Pool({
  connectionString: config.AUTH_DATABASE_URL,
  max: 10,
  application_name: "context-use-auth",
});

export const auth = betterAuth({
  appName: "context-use",
  baseURL: config.APP_ORIGIN,
  basePath: "/api/auth",
  secret: config.BETTER_AUTH_SECRET,
  database: authPool,
  telemetry: { enabled: false },
  trustedOrigins: [config.APP_ORIGIN],
  socialProviders: {
    google: {
      clientId: config.GOOGLE_CLIENT_ID,
      clientSecret: config.GOOGLE_CLIENT_SECRET,
      prompt: "select_account",
    },
  },
  session: {
    expiresIn: config.SESSION_MAX_SECONDS,
    updateAge: 3_600,
    cookieCache: { enabled: false },
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 60,
    customRules: {
      "/sign-in/social": { window: 60, max: 10 },
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
          if (!isVerifiedOwner(user.email, user.emailVerified)) {
            throw new APIError("FORBIDDEN", { message: "This installation accepts only its verified owner" });
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
    session: {
      create: {
        after: async (session) => {
          await authPool.query(
            `INSERT INTO security_audit_events(event_type,actor_type,actor_id,target_type,target_id)
             VALUES ('dashboard_session_created','owner',$1,'session',$2)`,
            [session.userId, session.id],
          );
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
        residentKey: "preferred",
        userVerification: "required",
      },
      registration: { requireSession: true },
    }),
    oauthProvider({
      loginPage: "/app/login",
      consentPage: "/app/oauth/consent",
      scopes: ["openid", "offline_access", "kb:read", "kb:write", "assets:read"],
      resources: [{
        identifier: config.MCP_RESOURCE,
        name: "context-use MCP",
        accessTokenTtl: 900,
        refreshTokenTtl: 2_592_000,
        allowedScopes: ["openid", "offline_access", "kb:read", "kb:write", "assets:read"],
      }],
      resourceSeedMode: "overwrite",
      enforcePerClientResources: false,
      grantTypes: ["authorization_code", "refresh_token"],
      accessTokenExpiresIn: 900,
      refreshTokenExpiresIn: 2_592_000,
      codeExpiresIn: 300,
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      clientRegistrationDefaultScopes: ["kb:read"],
      clientRegistrationAllowedScopes: ["kb:write", "assets:read", "offline_access", "openid"],
      clientRegistrationClientSecretExpiration: "30 days",
      silenceWarnings: { oauthAuthServerConfig: true, openidConfig: true },
      customAccessTokenClaims: ({ resources }) => ({
        principal_type: "mcp_agent",
        resource: resources?.[0] ?? config.MCP_RESOURCE,
      }),
      clientPrivileges: ({ user }) => user ? isVerifiedOwner(user.email, user.emailVerified) : undefined,
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
  const result = await auth.api.getSession({ headers: request.headers });
  if (!result || !isVerifiedOwner(result.user.email, result.user.emailVerified)) return null;

  const createdAt = new Date(result.session.createdAt).getTime();
  const updatedAt = new Date(result.session.updatedAt).getTime();
  const now = Date.now();
  if (now - createdAt > config.SESSION_MAX_SECONDS * 1_000) return null;
  if (now - updatedAt > config.SESSION_IDLE_SECONDS * 1_000) return null;
  return {
    userId: result.user.id,
    sessionId: result.session.id,
    email: result.user.email,
  };
}
