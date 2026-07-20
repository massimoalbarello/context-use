import { z } from "zod";

const developmentSecret = "development-only-secret-that-is-long-enough";
const developmentSetupTokenHash = "0c3f0f8b90068b05d8039bf05db2da4742c31a23e51cfa864a96a0efe17b1694";
const developmentMcpCapabilitySecret = "development-only-mcp-capability-secret";
const developmentConfirmationGatewayToken = "development-confirmation-gateway-token";
const developmentInternalTokens = {
  authDashboard: "development-auth-dashboard-internal-token",
  authMcp: "development-auth-private-mcp-internal-token",
  confirmationDashboard: "development-confirmation-dashboard-token",
};
const developmentStorageTokens = {
  dashboard: "development-storage-dashboard-token",
  mcp: "development-storage-private-mcp-token",
  public: "development-storage-public-web-token",
};

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  SERVICE_MODE: z.enum([
    "all", "dashboard-edge", "dashboard", "auth", "mcp", "public", "confirmation", "storage",
  ]).default("all"),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_ORIGIN: z.string().url().default("http://localhost:3000"),
  ASSET_ORIGIN: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1).default("postgres://context_use_dashboard:development-only@localhost:5432/context_use"),
  AUTH_DATABASE_URL: z.string().min(1).default("postgres://context_use_auth:development-only@localhost:5432/context_use"),
  MCP_DATABASE_URL: z.string().min(1).default("postgres://context_use_mcp:development-only@localhost:5432/context_use"),
  PUBLIC_DATABASE_URL: z.string().min(1).default("postgres://context_use_public:development-only@localhost:5432/context_use"),
  CONFIRMATION_DATABASE_URL: z.string().min(1).default("postgres://context_use_confirmation:development-only@localhost:5432/context_use"),
  STORAGE_DATABASE_URL: z.string().min(1).default("postgres://context_use_storage:development-only@localhost:5432/context_use"),
  DASHBOARD_AUTHORITY_URL: z.string().url().default("http://localhost:3000"),
  AUTH_INTERNAL_URL: z.string().url().default("http://localhost:3002"),
  CONFIRMATION_INTERNAL_URL: z.string().url().default("http://localhost:3004"),
  CONFIRMATION_GATEWAY_TOKEN: z.string().min(32).default(developmentConfirmationGatewayToken),
  AUTH_DASHBOARD_TOKEN: z.string().min(32).default(developmentInternalTokens.authDashboard),
  AUTH_MCP_TOKEN: z.string().min(32).default(developmentInternalTokens.authMcp),
  CONFIRMATION_DASHBOARD_TOKEN: z.string().min(32).default(developmentInternalTokens.confirmationDashboard),
  OWNER_EMAIL: z.string().email().default("owner@example.com"),
  OWNER_SETUP_TOKEN_HASH: z.string().regex(/^[a-f0-9]{64}$/).default(developmentSetupTokenHash),
  BETTER_AUTH_SECRET: z.string().min(32).default(developmentSecret),
  MCP_ASSET_CAPABILITY_SECRET: z.string().min(32).default(developmentMcpCapabilitySecret),
  OAUTH_ISSUER: z.string().url().default("http://localhost:3000"),
  MCP_RESOURCE: z.string().url().default("http://localhost:3000/mcp"),
  WEBAUTHN_RP_ID: z.string().min(1).default("localhost"),
  WEBAUTHN_RP_NAME: z.string().min(1).default("context-use"),
  STORAGE_DRIVER: z.enum(["filesystem", "s3"]).default("filesystem"),
  STORAGE_PATH: z.string().default("./data/assets"),
  STORAGE_SOCKET_PATH: z.string().min(1).default("/tmp/context-use-storage.sock"),
  STORAGE_DASHBOARD_TOKEN: z.string().min(32).default(developmentStorageTokens.dashboard),
  STORAGE_MCP_TOKEN: z.string().min(32).default(developmentStorageTokens.mcp),
  STORAGE_PUBLIC_TOKEN: z.string().min(32).default(developmentStorageTokens.public),
  WEB_DIST: z.string().default("./apps/web/dist"),
  AWS_REGION: z.string().default("eu-west-2"),
  AWS_CREDENTIALS_FILE: z.string().default(""),
  AWS_EC2_METADATA_DISABLED: z.enum(["true", "false"]).default("false"),
  ASSET_BUCKET: z.string().default(""),
  KMS_KEY_ID: z.string().default(""),
  SESSION_IDLE_SECONDS: z.coerce.number().int().positive().default(43_200),
  SESSION_MAX_SECONDS: z.coerce.number().int().positive().default(604_800),
});

export const config = schema.parse(process.env);
export const production = config.NODE_ENV === "production";

if (production) {
  const insecure: string[] = [];
  if (config.SERVICE_MODE === "all") insecure.push("SERVICE_MODE=all is forbidden in production");
  const app = new URL(config.APP_ORIGIN);
  const assets = new URL(config.ASSET_ORIGIN);
  const isBareOrigin = (url: URL) => url.pathname === "/" && !url.search && !url.hash && !url.username && !url.password;
  if (app.protocol !== "https:" || !isBareOrigin(app)) insecure.push("APP_ORIGIN must be an exact bare HTTPS origin");
  if (assets.protocol !== "https:" || !isBareOrigin(assets)) insecure.push("ASSET_ORIGIN must be an exact bare HTTPS origin");
  if (assets.hostname !== `assets.${app.hostname}`) insecure.push("ASSET_ORIGIN must use the dedicated assets subdomain");
  if (["auth", "mcp"].includes(config.SERVICE_MODE) && config.OAUTH_ISSUER !== config.APP_ORIGIN) insecure.push("OAUTH_ISSUER must equal APP_ORIGIN");
  if (["auth", "mcp"].includes(config.SERVICE_MODE) && config.MCP_RESOURCE !== `${config.APP_ORIGIN}/mcp`) insecure.push("MCP_RESOURCE must be the canonical /mcp URI");
  if (["auth", "confirmation"].includes(config.SERVICE_MODE) && config.WEBAUTHN_RP_ID !== app.hostname) insecure.push("WEBAUTHN_RP_ID must equal the application hostname");
  if (config.SERVICE_MODE === "auth" && config.BETTER_AUTH_SECRET === developmentSecret) insecure.push("BETTER_AUTH_SECRET must be changed");
  if (config.SERVICE_MODE === "auth" && config.OWNER_EMAIL === "owner@example.com") insecure.push("OWNER_EMAIL must be configured");
  if (config.SERVICE_MODE === "auth" && config.OWNER_SETUP_TOKEN_HASH === developmentSetupTokenHash) insecure.push("OWNER_SETUP_TOKEN_HASH must be changed");
  if (config.SERVICE_MODE === "mcp" && config.MCP_ASSET_CAPABILITY_SECRET === developmentMcpCapabilitySecret) insecure.push("MCP_ASSET_CAPABILITY_SECRET must be changed");
  if (["auth", "confirmation"].includes(config.SERVICE_MODE) && config.CONFIRMATION_GATEWAY_TOKEN === developmentConfirmationGatewayToken) insecure.push("CONFIRMATION_GATEWAY_TOKEN must be changed");
  if (["auth", "dashboard"].includes(config.SERVICE_MODE) && config.AUTH_DASHBOARD_TOKEN === developmentInternalTokens.authDashboard) insecure.push("AUTH_DASHBOARD_TOKEN must be changed");
  if (["auth", "mcp"].includes(config.SERVICE_MODE) && config.AUTH_MCP_TOKEN === developmentInternalTokens.authMcp) insecure.push("AUTH_MCP_TOKEN must be changed");
  if (["confirmation", "dashboard"].includes(config.SERVICE_MODE) && config.CONFIRMATION_DASHBOARD_TOKEN === developmentInternalTokens.confirmationDashboard) insecure.push("CONFIRMATION_DASHBOARD_TOKEN must be changed");
  if (["dashboard", "storage"].includes(config.SERVICE_MODE) && config.STORAGE_DASHBOARD_TOKEN === developmentStorageTokens.dashboard) insecure.push("STORAGE_DASHBOARD_TOKEN must be changed");
  if (["mcp", "storage"].includes(config.SERVICE_MODE) && config.STORAGE_MCP_TOKEN === developmentStorageTokens.mcp) insecure.push("STORAGE_MCP_TOKEN must be changed");
  if (["public", "storage"].includes(config.SERVICE_MODE) && config.STORAGE_PUBLIC_TOKEN === developmentStorageTokens.public) insecure.push("STORAGE_PUBLIC_TOKEN must be changed");
  if (config.SERVICE_MODE === "storage" && new Set([
    config.STORAGE_DASHBOARD_TOKEN,
    config.STORAGE_MCP_TOKEN,
    config.STORAGE_PUBLIC_TOKEN,
  ]).size !== 3) insecure.push("storage capability tokens must be distinct");
  if (config.SERVICE_MODE === "storage" && (!config.ASSET_BUCKET || config.STORAGE_DRIVER !== "s3")) insecure.push("production storage broker must use S3");
  if (config.SERVICE_MODE === "storage" && !config.KMS_KEY_ID) insecure.push("KMS_KEY_ID is required");
  if (config.SERVICE_MODE === "storage" && config.AWS_CREDENTIALS_FILE !== "/run/context-use-aws-storage/credentials.json") insecure.push("storage must use the scoped AWS credential file");
  if (config.SERVICE_MODE === "storage" && config.AWS_EC2_METADATA_DISABLED !== "true") insecure.push("storage must disable EC2 instance metadata");
  if (config.SERVICE_MODE === "auth" && config.SESSION_MAX_SECONDS > 604_800) insecure.push("dashboard sessions cannot exceed seven days");
  if (config.SERVICE_MODE === "auth" && (config.SESSION_IDLE_SECONDS > 43_200 || config.SESSION_IDLE_SECONDS >= config.SESSION_MAX_SECONDS)) insecure.push("dashboard idle timeout cannot exceed twelve hours");
  const databaseRoles = new Map([
    ["DATABASE_URL", [config.DATABASE_URL, "context_use_dashboard"]],
    ["AUTH_DATABASE_URL", [config.AUTH_DATABASE_URL, "context_use_auth"]],
    ["MCP_DATABASE_URL", [config.MCP_DATABASE_URL, "context_use_mcp"]],
    ["PUBLIC_DATABASE_URL", [config.PUBLIC_DATABASE_URL, "context_use_public"]],
    ["CONFIRMATION_DATABASE_URL", [config.CONFIRMATION_DATABASE_URL, "context_use_confirmation"]],
    ["STORAGE_DATABASE_URL", [config.STORAGE_DATABASE_URL, "context_use_storage"]],
  ]);
  const allowedByService: Record<typeof config.SERVICE_MODE, string[]> = {
    all: [...databaseRoles.keys()],
    "dashboard-edge": [],
    dashboard: ["DATABASE_URL"],
    auth: ["AUTH_DATABASE_URL"],
    mcp: ["MCP_DATABASE_URL"],
    public: ["PUBLIC_DATABASE_URL"],
    confirmation: ["CONFIRMATION_DATABASE_URL"],
    storage: ["STORAGE_DATABASE_URL"],
  };
  const allowedDatabases = new Set(allowedByService[config.SERVICE_MODE]);
  for (const [name, [connection, role]] of databaseRoles) {
    if (!allowedDatabases.has(name)) {
      if (process.env[name] !== undefined) insecure.push(`${name} must not be present in the ${config.SERVICE_MODE} service`);
      continue;
    }
    try {
      const parsed = new URL(connection!);
      if (!parsed.protocol.startsWith("postgres") || decodeURIComponent(parsed.username) !== role) insecure.push(`${name} must use only ${role}`);
    } catch {
      insecure.push(`${name} must be a valid PostgreSQL URL`);
    }
  }
  if (["dashboard", "mcp"].includes(config.SERVICE_MODE) && config.AUTH_INTERNAL_URL !== "http://auth:3002") {
    insecure.push("AUTH_INTERNAL_URL must use the dedicated auth service network");
  }
  if (config.SERVICE_MODE === "dashboard-edge" && config.DASHBOARD_AUTHORITY_URL !== "http://app:3000") {
    insecure.push("DASHBOARD_AUTHORITY_URL must use the isolated dashboard authority network");
  }
  if (["dashboard", "auth"].includes(config.SERVICE_MODE) && config.CONFIRMATION_INTERNAL_URL !== "http://confirmation:3004") {
    insecure.push("CONFIRMATION_INTERNAL_URL must use the dedicated confirmation service network");
  }

  const sensitiveByService: Record<string, string[]> = {
    MIGRATOR_DATABASE_URL: [],
    DATABASE_ADMIN_URL: [],
    POSTGRES_PASSWORD: [],
    PGPASSWORD: [],
    DB_AUTH_PASSWORD: [],
    DB_DASHBOARD_PASSWORD: [],
    DB_MCP_PASSWORD: [],
    DB_PUBLIC_PASSWORD: [],
    DB_CONFIRMATION_PASSWORD: [],
    DB_STORAGE_PASSWORD: [],
    DB_BACKUP_PASSWORD: [],
    BETTER_AUTH_SECRET: ["auth"],
    OWNER_EMAIL: ["auth"],
    OWNER_SETUP_TOKEN_HASH: ["auth"],
    AUTH_EDGE_TOKEN: [],
    MCP_ASSET_CAPABILITY_SECRET: ["mcp"],
    CONFIRMATION_GATEWAY_TOKEN: ["auth", "confirmation"],
    AUTH_DASHBOARD_TOKEN: ["auth", "dashboard"],
    AUTH_MCP_TOKEN: ["auth", "mcp"],
    CONFIRMATION_DASHBOARD_TOKEN: ["confirmation", "dashboard"],
    STORAGE_DASHBOARD_TOKEN: ["dashboard", "storage"],
    STORAGE_MCP_TOKEN: ["mcp", "storage"],
    STORAGE_PUBLIC_TOKEN: ["public", "storage"],
    AWS_ACCESS_KEY_ID: [],
    AWS_SECRET_ACCESS_KEY: [],
    AWS_SESSION_TOKEN: [],
    AWS_CREDENTIALS_FILE: ["storage"],
    ASSET_BUCKET: ["storage"],
    KMS_KEY_ID: ["storage"],
  };
  for (const [name, allowedServices] of Object.entries(sensitiveByService)) {
    if (process.env[name] !== undefined && !allowedServices.includes(config.SERVICE_MODE)) {
      insecure.push(`${name} must not be present in the ${config.SERVICE_MODE} service`);
    }
  }
  if (insecure.length) throw new Error(`Unsafe production configuration: ${insecure.join("; ")}`);
}
