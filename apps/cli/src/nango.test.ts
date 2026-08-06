import { expect, test } from "bun:test";
import {
  ensureNangoApiKeys,
  nangoApiKeyReconciliationCommands,
  verifyNangoDashboardAuthentication,
} from "./nango.ts";
import { generateNangoAuthCookieSecret, generateNangoEncryptionKey, nangoAuthCookieSecretUsable } from "./setup.ts";
import type { DataOutputs, DeploymentConfig } from "./types.ts";

const config: DeploymentConfig = {
  schemaVersion: 2,
  releaseVersion: "v0.1.54",
  environment: "production",
  installationId: "abcdef123456",
  awsProfile: "default",
  awsRegion: "eu-west-2",
  availabilityZone: "eu-west-2a",
  accountId: "123456789012",
  hostname: "context.example.com",
  assetHostname: "assets.context.example.com",
  nangoHostname: "nango.context.example.com",
  dnsMode: "route53",
  route53ZoneId: "zone",
  ownerEmail: "owner@example.com",
  stateBucket: "state",
  instanceType: "t3.large",
  dataVolumeSizeGb: 50,
  backupRetentionDays: 30,
};

const data: DataOutputs = {
  kms_key_arn: "arn:aws:kms:eu-west-2:123456789012:key/data-key",
  kms_key_id: "data",
  data_volume_id: "vol-data",
  asset_bucket: "assets",
  backup_bucket: "backups",
};

test("Nango's encryption key is exactly 256 bits encoded as standard base64", () => {
  const key = generateNangoEncryptionKey();
  expect(key).toMatch(/^[A-Za-z0-9+/]{43}=$/);
  expect(Buffer.from(key, "base64")).toHaveLength(32);
});

test("Nango's auth cookie key is a 256 bit key OAuth2 Proxy can decode", () => {
  // OAuth2 Proxy decodes the secret as base64url. A standard base64 generator
  // only produces a rejected value when the draw happens to contain + or /, so
  // a single sample passes roughly a quarter of the time.
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const key = generateNangoAuthCookieSecret();
    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(key, "base64url")).toHaveLength(32);
    expect(nangoAuthCookieSecretUsable(key)).toBe(true);
  }
});

test("cookie secrets OAuth2 Proxy would reject are replaced rather than deployed", () => {
  // The padded all-A key deploy.sh passes to --config-test must stay usable.
  expect(nangoAuthCookieSecretUsable(`${"A".repeat(43)}=`)).toBe(true);
  expect(nangoAuthCookieSecretUsable("x".repeat(32))).toBe(true);
  // Standard base64 carrying either character outside the URL-safe alphabet
  // reaches OAuth2 Proxy as a 44 byte string and crash-loops it.
  expect(nangoAuthCookieSecretUsable(`${"A".repeat(42)}+=`)).toBe(false);
  expect(nangoAuthCookieSecretUsable(`${"A".repeat(42)}/=`)).toBe(false);
  expect(nangoAuthCookieSecretUsable("short")).toBe(false);
});

test("Nango dashboard authentication verifies anonymous denial and internal Basic success", async () => {
  const calls: string[] = [];
  const verified = await verifyNangoDashboardAuthentication(config, data, "i-123abc", {
    anonymousFetcher: (async () => {
      calls.push("anonymous");
      return Response.json({}, { status: 401 });
    }) as unknown as typeof fetch,
    authorizedFetcher: (async () => {
      calls.push("authorized");
      return Response.json({});
    }) as unknown as typeof fetch,
  });
  expect(verified).toBe(true);
  expect(calls).toEqual(["anonymous", "authorized"]);

  await expect(verifyNangoDashboardAuthentication(config, data, "i-123abc", {
    anonymousFetcher: (async () => Response.json({})) as unknown as typeof fetch,
    authorizedFetcher: (async () => Response.json({})) as unknown as typeof fetch,
  })).rejects.toThrow("expected 401");
});

test("Nango API key reconciliation keeps all secrets inside an on-instance pipe", () => {
  const commands = nangoApiKeyReconciliationCommands(config, data);
  const text = commands.join("\n");
  const parameterNames = [
    "NANGO_DEPLOYER_API_KEY",
    "NANGO_PIPELINE_API_KEY",
    "NANGO_INTEGRATION_MANAGER_API_KEY",
  ];

  expect(text.match(/aws ssm put-parameter/g)).toHaveLength(3);
  expect(text.match(/--value file:\/\/\/dev\/stdin/g)).toHaveLength(3);
  expect(text.match(/--with-decryption --query Parameter\.Value/g)).toHaveLength(3);
  expect(text).not.toContain("--query Parameter.Name");
  expect(text).not.toContain("--value \"");
  expect(text).not.toContain("usableSecret");
  expect(text).not.toContain("dashboard-password");
  expect(text).not.toContain("manager-secret");
  for (const parameterName of parameterNames) {
    expect(text).toContain(`/context-use/abcdef123456/production/${parameterName}' --type SecureString`);
  }
  expect(commands.at(-1)).toBe("echo 'CONTEXT_USE_NANGO_KEYS_OK'");

  const encoded = commands.find((command) => command.startsWith("nango_key_worker='"))
    ?.slice("nango_key_worker='".length, -1);
  expect(encoded).toBeTruthy();
  const worker = Buffer.from(encoded!, "base64").toString("utf8");
  expect(() => new Function(worker)).not.toThrow();
  expect(worker).not.toContain("console.log");
  expect(worker).not.toContain("console.error");
  expect(worker).toContain("process.stdout.write(key.secret)");
  expect(worker).toContain("Authorization: \"Bearer \" + secret");
  expect(worker).toContain("/functions/deployments/00000000-0000-0000-0000-000000000000");
  expect(worker).toContain("/connections?limit=1&page=0");
  expect(worker).toContain("/scripts/config");
});

test("existing Nango keys always replace present SSM values and are verified from storage", () => {
  const commands = nangoApiKeyReconciliationCommands(config, data);
  const text = commands.join("\n");

  expect(text).not.toContain("CONTEXT_USE_KEY_MODE=inspect");
  expect(text).not.toContain("CONTEXT_USE_KEY_MODE=reconcile");
  expect(text).not.toContain("nango_key_state");
  expect(text).not.toContain("nango_parameter_state");
  for (const parameterName of [
    "NANGO_DEPLOYER_API_KEY",
    "NANGO_PIPELINE_API_KEY",
    "NANGO_INTEGRATION_MANAGER_API_KEY",
  ]) {
    const parameter = `/context-use/abcdef123456/production/${parameterName}`;
    const writeIndex = commands.findIndex((command) => command.includes(`put-parameter --name '${parameter}'`));
    const verifyIndex = commands.findIndex((command) => command.includes(`get-parameter --name '${parameter}' --with-decryption`));
    expect(writeIndex).toBeGreaterThan(-1);
    expect(commands[writeIndex]).toContain("CONTEXT_USE_KEY_MODE=write");
    expect(verifyIndex).toBe(writeIndex + 1);
    expect(commands[verifyIndex]).toContain("| docker compose");
    expect(commands[verifyIndex]).toContain("CONTEXT_USE_KEY_MODE=verify");
  }
});

test("Nango API key reconciliation accepts only its fixed success marker", async () => {
  const sent: string[][] = [];
  await ensureNangoApiKeys(config, data, "i-123abc", {
    sendCommands: async (_profile, _region, _instance, commands) => {
      sent.push(commands);
      return sent.length === 1
        ? "CONTEXT_USE_NANGO_KEYS_OK\n"
        : "CONTEXT_USE_NANGO_BOUNDARY_OK\n";
    },
  });
  expect(sent[0]).toEqual(nangoApiKeyReconciliationCommands(config, data));
  expect(sent[1]?.join("\n")).toContain("NANGO_INTEGRATION_MANAGER_API_KEY");

  await expect(ensureNangoApiKeys(config, data, "i-123abc", {
    sendCommands: async () => "unexpected Nango JSON",
  })).rejects.toThrow("invalid response");
});

test("Nango API key command construction rejects shell-injectable infrastructure values", () => {
  expect(() => nangoApiKeyReconciliationCommands(
    { ...config, environment: "production'; touch /tmp/x" },
    data,
  )).toThrow("Invalid Nango parameter prefix");
  expect(() => nangoApiKeyReconciliationCommands(config, {
    ...data,
    kms_key_arn: "arn:aws:kms:eu-west-2:123456789012:key/data'; touch /tmp/x",
  })).toThrow("Invalid Nango parameter KMS key");
});
