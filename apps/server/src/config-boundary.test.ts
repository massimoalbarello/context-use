import { describe, expect, test } from "bun:test";

const configUrl = new URL("./config.ts", import.meta.url).href;

const common = {
  NODE_ENV: "production",
  APP_ORIGIN: "https://context.example.com",
  ASSET_ORIGIN: "https://assets.context.example.com",
  PUBLIC_MCP_ENDPOINT: "https://public.context.example.com/mcp",
};

const validByService: Record<string, Record<string, string>> = {
  dashboard: {
    DATABASE_URL: "postgres://context_use_dashboard:secret@postgres:5432/context_use",
    AUTH_INTERNAL_URL: "http://auth:3002",
    CONFIRMATION_INTERNAL_URL: "http://confirmation:3004",
    AUTH_DASHBOARD_TOKEN: "dashboard-to-auth-token-that-is-not-shared",
    CONFIRMATION_DASHBOARD_TOKEN: "dashboard-to-confirmation-token-not-shared",
    STORAGE_DASHBOARD_TOKEN: "dashboard-storage-token-that-is-not-shared",
  },
  auth: {
    AUTH_DATABASE_URL: "postgres://context_use_auth:secret@postgres:5432/context_use",
    CONFIRMATION_INTERNAL_URL: "http://confirmation:3004",
    CONFIRMATION_GATEWAY_TOKEN: "confirmation-gateway-token-that-is-shared-only-here",
    OAUTH_ISSUER: common.APP_ORIGIN,
    MCP_RESOURCE: `${common.APP_ORIGIN}/mcp`,
    WEBAUTHN_RP_ID: "context.example.com",
    OWNER_EMAIL: "owner@context.example.com",
    OWNER_SETUP_TOKEN_HASH: "a".repeat(64),
    BETTER_AUTH_SECRET: "authentication-secret-that-is-not-shared",
    AUTH_DASHBOARD_TOKEN: "dashboard-to-auth-token-that-is-not-shared",
    AUTH_MCP_TOKEN: "private-mcp-to-auth-token-that-is-not-shared",
  },
  mcp: {
    MCP_DATABASE_URL: "postgres://context_use_mcp:secret@postgres:5432/context_use",
    AUTH_INTERNAL_URL: "http://auth:3002",
    AUTH_MCP_TOKEN: "private-mcp-to-auth-token-that-is-not-shared",
    OAUTH_ISSUER: common.APP_ORIGIN,
    MCP_RESOURCE: `${common.APP_ORIGIN}/mcp`,
    MCP_ASSET_CAPABILITY_SECRET: "mcp-capability-secret-that-is-not-shared",
    STORAGE_MCP_TOKEN: "private-mcp-storage-token-not-shared",
  },
  public: {
    PUBLIC_DATABASE_URL: "postgres://context_use_public:secret@postgres:5432/context_use",
    STORAGE_PUBLIC_TOKEN: "public-storage-token-that-is-not-shared",
  },
  confirmation: {
    CONFIRMATION_DATABASE_URL: "postgres://context_use_confirmation:secret@postgres:5432/context_use",
    WEBAUTHN_RP_ID: "context.example.com",
    CONFIRMATION_GATEWAY_TOKEN: "confirmation-gateway-token-that-is-shared-only-here",
    CONFIRMATION_DASHBOARD_TOKEN: "dashboard-to-confirmation-token-not-shared",
  },
  storage: {
    STORAGE_DATABASE_URL: "postgres://context_use_storage:secret@127.0.0.1:5432/context_use",
    STORAGE_DRIVER: "s3",
    AWS_CREDENTIALS_FILE: "/run/context-use-aws-storage/credentials.json",
    AWS_EC2_METADATA_DISABLED: "true",
    ASSET_BUCKET: "private-assets",
    KMS_KEY_ID: "arn:aws:kms:eu-west-2:123456789012:key/test",
    STORAGE_DASHBOARD_TOKEN: "dashboard-storage-token-that-is-not-shared",
    STORAGE_MCP_TOKEN: "private-mcp-storage-token-not-shared",
    STORAGE_PUBLIC_TOKEN: "public-storage-token-that-is-not-shared",
  },
};

function load(service: string, overrides: Record<string, string> = {}) {
  return Bun.spawnSync([
    process.execPath,
    "-e",
    `await import(${JSON.stringify(configUrl)})`,
  ], {
    env: { ...common, SERVICE_MODE: service, ...validByService[service], ...overrides },
    stdout: "pipe",
    stderr: "pipe",
  });
}

describe("production process credential boundaries", () => {
  for (const service of Object.keys(validByService)) {
    test(`${service} starts with only its intended credential`, () => {
      const result = load(service);
      expect(result.exitCode, result.stderr.toString()).toBe(0);
    });
  }

  test("dashboard refuses an auth database credential or auth signing secret", () => {
    expect(load("dashboard", {
      AUTH_DATABASE_URL: "postgres://context_use_auth:secret@postgres:5432/context_use",
    }).exitCode).not.toBe(0);
    expect(load("dashboard", {
      BETTER_AUTH_SECRET: "leaked-authentication-secret-that-is-long",
    }).exitCode).not.toBe(0);
    expect(load("dashboard", {
      CONFIRMATION_GATEWAY_TOKEN: "leaked-confirmation-gateway-token-that-is-long",
    }).exitCode).not.toBe(0);
    expect(load("dashboard", {
      AUTH_MCP_TOKEN: "leaked-private-mcp-auth-token-that-is-long",
    }).exitCode).not.toBe(0);
    expect(load("dashboard", {
      STORAGE_DATABASE_URL: "postgres://context_use_storage:secret@postgres:5432/context_use",
    }).exitCode).not.toBe(0);
  });

  test("each database URL must name exactly the service role", () => {
    const result = load("dashboard", {
      DATABASE_URL: "postgres://postgres:secret@postgres:5432/context_use",
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("DATABASE_URL must use only context_use_dashboard");
  });

  test("combined production mode and shared storage tokens are forbidden", () => {
    expect(load("all").exitCode).not.toBe(0);
    const shared = "one-storage-token-that-must-never-be-shared";
    expect(load("storage", {
      STORAGE_DASHBOARD_TOKEN: shared,
      STORAGE_MCP_TOKEN: shared,
      STORAGE_PUBLIC_TOKEN: shared,
    }).exitCode).not.toBe(0);
  });

  test("web-facing services reject explicit AWS credentials", () => {
    expect(load("mcp", { AWS_ACCESS_KEY_ID: "should-not-be-here" }).exitCode).not.toBe(0);
    expect(load("public", { AWS_SESSION_TOKEN: "should-not-be-here" }).exitCode).not.toBe(0);
  });
});
