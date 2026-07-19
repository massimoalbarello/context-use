import { z } from "zod";

const developmentSecret = "development-only-secret-that-is-long-enough";
const developmentSetupTokenHash = "0c3f0f8b90068b05d8039bf05db2da4742c31a23e51cfa864a96a0efe17b1694";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_ORIGIN: z.string().url().default("http://localhost:3000"),
  ASSET_ORIGIN: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1).default("postgres://context_use_dashboard:development-only@localhost:5432/context_use"),
  AUTH_DATABASE_URL: z.string().min(1).default("postgres://context_use_auth:development-only@localhost:5432/context_use"),
  MCP_DATABASE_URL: z.string().min(1).default("postgres://context_use_mcp:development-only@localhost:5432/context_use"),
  PUBLIC_DATABASE_URL: z.string().min(1).default("postgres://context_use_public:development-only@localhost:5432/context_use"),
  PUBLISHER_DATABASE_URL: z.string().min(1).default("postgres://context_use_publisher:development-only@localhost:5432/context_use"),
  OWNER_EMAIL: z.string().email().default("owner@example.com"),
  OWNER_SETUP_TOKEN_HASH: z.string().regex(/^[a-f0-9]{64}$/).default(developmentSetupTokenHash),
  BETTER_AUTH_SECRET: z.string().min(32).default(developmentSecret),
  OAUTH_ISSUER: z.string().url().default("http://localhost:3000"),
  MCP_RESOURCE: z.string().url().default("http://localhost:3000/mcp"),
  PUBLIC_MCP_ENDPOINT: z.string().url().default("http://localhost:3001/mcp"),
  WEBAUTHN_RP_ID: z.string().min(1).default("localhost"),
  WEBAUTHN_RP_NAME: z.string().min(1).default("context-use"),
  STORAGE_DRIVER: z.enum(["filesystem", "s3"]).default("filesystem"),
  STORAGE_PATH: z.string().default("./data/assets"),
  WEB_DIST: z.string().default("./apps/web/dist"),
  AWS_REGION: z.string().default("eu-west-2"),
  ASSET_BUCKET: z.string().default(""),
  KMS_KEY_ID: z.string().default(""),
  MCP_INTROSPECTION_CLIENT_ID: z.string().default(""),
  MCP_INTROSPECTION_CLIENT_SECRET: z.string().default(""),
  SESSION_IDLE_SECONDS: z.coerce.number().int().positive().default(43_200),
  SESSION_MAX_SECONDS: z.coerce.number().int().positive().default(604_800),
});

export const config = schema.parse(process.env);
export const production = config.NODE_ENV === "production";

if (production) {
  const insecure: string[] = [];
  const app = new URL(config.APP_ORIGIN);
  const assets = new URL(config.ASSET_ORIGIN);
  const publicMcp = new URL(config.PUBLIC_MCP_ENDPOINT);
  const isBareOrigin = (url: URL) => url.pathname === "/" && !url.search && !url.hash && !url.username && !url.password;
  if (app.protocol !== "https:" || !isBareOrigin(app)) insecure.push("APP_ORIGIN must be an exact bare HTTPS origin");
  if (assets.protocol !== "https:" || !isBareOrigin(assets)) insecure.push("ASSET_ORIGIN must be an exact bare HTTPS origin");
  if (assets.hostname !== `assets.${app.hostname}`) insecure.push("ASSET_ORIGIN must use the dedicated assets subdomain");
  if (config.OAUTH_ISSUER !== config.APP_ORIGIN) insecure.push("OAUTH_ISSUER must equal APP_ORIGIN");
  if (config.MCP_RESOURCE !== `${config.APP_ORIGIN}/mcp`) insecure.push("MCP_RESOURCE must be the canonical /mcp URI");
  if (publicMcp.protocol !== "https:" || publicMcp.search || publicMcp.hash) insecure.push("PUBLIC_MCP_ENDPOINT must be an HTTPS URL without a query or fragment");
  if (publicMcp.origin === app.origin) insecure.push("PUBLIC_MCP_ENDPOINT must use the dedicated public MCP origin");
  if (config.WEBAUTHN_RP_ID !== app.hostname) insecure.push("WEBAUTHN_RP_ID must equal the application hostname");
  if (config.BETTER_AUTH_SECRET === developmentSecret) insecure.push("BETTER_AUTH_SECRET must be changed");
  if (config.OWNER_EMAIL === "owner@example.com") insecure.push("OWNER_EMAIL must be configured");
  if (config.OWNER_SETUP_TOKEN_HASH === developmentSetupTokenHash) insecure.push("OWNER_SETUP_TOKEN_HASH must be changed");
  if (!config.ASSET_BUCKET || config.STORAGE_DRIVER !== "s3") insecure.push("production storage must be S3");
  if (!config.KMS_KEY_ID) insecure.push("KMS_KEY_ID is required");
  if (config.SESSION_MAX_SECONDS > 604_800) insecure.push("dashboard sessions cannot exceed seven days");
  if (config.SESSION_IDLE_SECONDS > 43_200 || config.SESSION_IDLE_SECONDS >= config.SESSION_MAX_SECONDS) insecure.push("dashboard idle timeout cannot exceed twelve hours");
  const expectedRoles = new Map([
    ["DATABASE_URL", [config.DATABASE_URL, "context_use_dashboard"]],
    ["AUTH_DATABASE_URL", [config.AUTH_DATABASE_URL, "context_use_auth"]],
    ["MCP_DATABASE_URL", [config.MCP_DATABASE_URL, "context_use_mcp"]],
    ["PUBLIC_DATABASE_URL", [config.PUBLIC_DATABASE_URL, "context_use_public"]],
    ["PUBLISHER_DATABASE_URL", [config.PUBLISHER_DATABASE_URL, "context_use_publisher"]],
  ]);
  for (const [name, [connection, role]] of expectedRoles) {
    try {
      const parsed = new URL(connection!);
      if (!parsed.protocol.startsWith("postgres") || decodeURIComponent(parsed.username) !== role) insecure.push(`${name} must use only ${role}`);
    } catch {
      insecure.push(`${name} must be a valid PostgreSQL URL`);
    }
  }
  if (insecure.length) throw new Error(`Unsafe production configuration: ${insecure.join("; ")}`);
}
