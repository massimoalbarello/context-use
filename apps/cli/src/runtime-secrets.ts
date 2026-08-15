import { randomBytes } from "node:crypto";

/**
 * Runtime secrets a deployment needs, and how many random bytes each one gets.
 *
 * Both targets generate the same named values; only where they are kept
 * differs. The cloud installation stores them as KMS-encrypted SSM parameters
 * and materializes `runtime.env` on the instance, while a local installation
 * writes `runtime.env` directly. Keeping one table means a service added to
 * `deploy/docker-compose.yml` and `deploy/compose.local.yml` cannot silently
 * lose its credential on one of them.
 */
export const RUNTIME_SECRET_LENGTHS = {
  BETTER_AUTH_SECRET: 48,
  POSTGRES_PASSWORD: 36,
  DB_AUTH_PASSWORD: 36,
  DB_DASHBOARD_PASSWORD: 36,
  DB_MCP_PASSWORD: 36,
  DB_PUBLIC_PASSWORD: 36,
  DB_CONFIRMATION_PASSWORD: 36,
  DB_STORAGE_PASSWORD: 36,
  DB_BACKUP_PASSWORD: 36,
  NANGO_DASHBOARD_PASSWORD: 36,
  NANGO_ADMIN_KEY: 48,
  NANGO_ENCRYPTION_KEY: 32,
  NANGO_OAUTH_CLIENT_ID: 24,
  NANGO_OAUTH_CLIENT_SECRET: 32,
  NANGO_AUTH_COOKIE_SECRET: 32,
  AUTH_NANGO_TOKEN: 32,
  NANGO_DB_PASSWORD: 36,
  NANGO_BACKUP_DB_PASSWORD: 36,
  MCP_ASSET_CAPABILITY_SECRET: 48,
  CONFIRMATION_GATEWAY_TOKEN: 48,
  AUTH_DASHBOARD_TOKEN: 48,
  AUTH_MCP_TOKEN: 48,
  CONFIRMATION_DASHBOARD_TOKEN: 48,
  STORAGE_DASHBOARD_TOKEN: 48,
  STORAGE_MCP_TOKEN: 48,
  STORAGE_PUBLIC_TOKEN: 48,
} as const;

export type RuntimeSecretName = keyof typeof RUNTIME_SECRET_LENGTHS;

/**
 * The subset a local installation needs. It omits the credentials that exist
 * only for the cloud deployment's public Nango edge: OAuth2 Proxy's OIDC client
 * and cookie secret, and the first-party token the auth service uses to
 * complete that flow. A loopback Nango has no such edge.
 */
export const LOCAL_RUNTIME_SECRETS: RuntimeSecretName[] = (
  Object.keys(RUNTIME_SECRET_LENGTHS) as RuntimeSecretName[]
).filter((name) => ![
  "NANGO_OAUTH_CLIENT_ID",
  "NANGO_OAUTH_CLIENT_SECRET",
  "NANGO_AUTH_COOKIE_SECRET",
  "AUTH_NANGO_TOKEN",
].includes(name));

/** Nango requires a 32-byte key presented as standard base64. */
export function generateNangoEncryptionKey(): string {
  return randomBytes(32).toString("base64");
}
