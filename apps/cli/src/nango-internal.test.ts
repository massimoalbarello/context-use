import { expect, test } from "bun:test";
import {
  assertInternalNangoRequestBody,
  assertInternalNangoRoute,
  cleanupStaleNangoRequestParameters,
  createInternalNangoFetcher,
  externalNangoBoundaryCommands,
  internalNangoRequestCommands,
  probeInternalNangoReady,
  verifyExternalNangoBoundary,
} from "./nango-internal.ts";
import type { DataOutputs, DeploymentConfig } from "./types.ts";

const config: DeploymentConfig = {
  schemaVersion: 2,
  releaseVersion: "v0.1.54",
  environment: "production",
  installationId: "abcdef123456",
  awsProfile: "owner",
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
  kms_key_arn: "arn:aws:kms:eu-west-2:123456789012:key/data",
  kms_key_id: "data",
  data_volume_id: "vol-data",
  asset_bucket: "assets",
  backup_bucket: "backups",
};

const noStaleRequests = async () => [];

function encodedResponse(body: unknown, status = 200): string {
  const envelope = {
    status,
    statusText: status === 200 ? "OK" : "Not Found",
    contentType: "application/json",
    body: JSON.stringify(body),
  };
  return `CONTEXT_USE_NANGO_RESPONSE:${Buffer.from(JSON.stringify(envelope)).toString("base64")}\n`;
}

function decodedRemoteSource(access: "anonymous" | "dashboard" | "integration-manager" = "dashboard"): string {
  const commands = internalNangoRequestCommands({
    access,
    requestParameter: "/context-use/abcdef123456/production/internal-requests/nango-33333333333333333333333333333333",
    method: "GET",
    path: access === "integration-manager" ? "/scripts/config" : "/api/v1/user",
    ...(access === "integration-manager"
      ? { apiKeyParameter: "/context-use/abcdef123456/production/NANGO_INTEGRATION_MANAGER_API_KEY" }
      : {}),
  }).join("\n");
  const marker = "Buffer.from('";
  const start = commands.indexOf(marker) + marker.length;
  const end = commands.indexOf("','base64'", start);
  return Buffer.from(commands.slice(start, end), "base64").toString("utf8");
}

test("internal Nango controller routes are an exact method and path allowlist", () => {
  const instanceConnectionId = `agent-sync-${"a".repeat(32)}`;
  expect(() => assertInternalNangoRoute(
    "dashboard",
    "GET",
    new URL("https://nango.context.example.com/api/v1/environment/api-keys?env=prod"),
  )).toThrow("access denied");
  expect(() => assertInternalNangoRoute(
    "integration-manager",
    "GET",
    new URL("https://nango.context.example.com/connections?integrationId=github&limit=25&page=0"),
  )).not.toThrow();
  expect(() => assertInternalNangoRoute(
    "integration-manager",
    "GET",
    new URL("https://nango.context.example.com/connections?integrationId=github&limit=100&page=0"),
  )).toThrow("access denied");
  expect(() => assertInternalNangoRoute(
    "integration-manager",
    "GET",
    new URL("https://nango.context.example.com/integrations/unmanaged"),
  )).toThrow("access denied");
  expect(() => assertInternalNangoRoute(
    "integration-manager",
    "GET",
    new URL(`https://nango.context.example.com/connections/${instanceConnectionId}?provider_config_key=agent-conversations`),
  )).not.toThrow();
  expect(() => assertInternalNangoRoute(
    "integration-manager",
    "GET",
    new URL("https://nango.context.example.com/connections/agent-sync-owner-mac?provider_config_key=agent-conversations"),
  )).toThrow("access denied");
  expect(() => assertInternalNangoRoute(
    "integration-manager",
    "POST",
    new URL("https://nango.context.example.com/proxy"),
  )).toThrow("access denied");
  expect(() => assertInternalNangoRoute(
    "anonymous",
    "GET",
    new URL("https://nango.context.example.com/records"),
  )).toThrow("access denied");
  expect(() => assertInternalNangoRoute(
    "anonymous",
    "GET",
    new URL("https://nango.context.example.com/ready"),
  )).toThrow("access denied");
});

test("internal Nango mutation bodies allow only managed integration and agent metadata shapes", () => {
  const instanceId = "b".repeat(32);
  const metadata = {
    authenticated_webhook: { state: "active", token_sha256: "a".repeat(64) },
    deployment_id: "abcdef123456",
    label: "owner-mac",
    daemon_version: "v0.1.54",
    updated_at: "2026-08-05T12:00:00.000Z",
  };
  expect(() => assertInternalNangoRequestBody(
    "integration-manager",
    "POST",
    new URL("https://nango.context.example.com/connections"),
    JSON.stringify({
      provider_config_key: "agent-conversations",
      connection_id: "agent-sync",
      credentials: { type: "NONE" },
      metadata,
    }),
  )).not.toThrow();
  expect(() => assertInternalNangoRequestBody(
    "integration-manager",
    "POST",
    new URL("https://nango.context.example.com/connections"),
    JSON.stringify({
      provider_config_key: "agent-conversations",
      connection_id: `agent-sync-${instanceId}`,
      credentials: { type: "NONE" },
      metadata: { ...metadata, instance_id: instanceId, label: "second-mac" },
    }),
  )).not.toThrow();
  expect(() => assertInternalNangoRequestBody(
    "integration-manager",
    "POST",
    new URL("https://nango.context.example.com/connections"),
    JSON.stringify({
      provider_config_key: "agent-conversations",
      connection_id: `agent-sync-${instanceId}`,
      credentials: { type: "NONE" },
      metadata: { ...metadata, instance_id: "c".repeat(32) },
    }),
  )).toThrow("request body denied");
  expect(() => assertInternalNangoRequestBody(
    "integration-manager",
    "POST",
    new URL("https://nango.context.example.com/connections/metadata"),
    JSON.stringify({
      provider_config_key: "agent-conversations",
      connection_id: "agent-sync",
      metadata: { ...metadata, arbitrary: "not allowed" },
    }),
  )).toThrow("request body denied");
});

test("generic Nango responses use purpose-specific projections rather than redaction", () => {
  const source = decodedRemoteSource("integration-manager");
  expect(() => new Function(source)).not.toThrow();
  expect(source).toContain("projectIntegration");
  expect(source).toContain("projectAgentMetadata");
  expect(source).toContain("payload.connections.length > 25");
  expect(source).toContain('expectedSync = { github: "pull-requests"');
  expect(source).not.toContain("[REDACTED]");
  expect(source).not.toContain("sensitive.has");
  expect(source).not.toContain("api-keys");
});

test("internal Nango requests keep bodies in encrypted SSM and credentials on-instance", async () => {
  const secret = "github-oauth-secret-that-must-not-enter-the-command";
  const writes: Array<{ name: string; value: string; key: string }> = [];
  const deletes: string[] = [];
  let remoteCommands: string[] = [];
  const fetcher = createInternalNangoFetcher(config, data, "i-123abc", "integration-manager", {
    requestId: () => "1".repeat(32),
    listRequests: noStaleRequests,
    putRequest: async (_profile, _region, name, value, key) => { writes.push({ name, value, key }); },
    deleteRequest: async (_profile, _region, name) => { deletes.push(name); },
    sendCommands: async (profile, region, instanceId, commands) => {
      expect([profile, region, instanceId]).toEqual(["owner", "eu-west-2", "i-123abc"]);
      remoteCommands = commands;
      return encodedResponse({
        data: {
          unique_key: "github",
          provider: "github",
          display_name: "GitHub",
          forward_webhooks: false,
        },
      });
    },
  });

  const response = await fetcher("https://nango.context.example.com/integrations", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: "github",
      unique_key: "github",
      display_name: "GitHub",
      forward_webhooks: false,
      credentials: {
        type: "OAUTH2",
        client_id: "github-client",
        client_secret: secret,
        scopes: "repo",
      },
    }),
  });

  expect((await response.json() as { data: { unique_key: string } }).data.unique_key).toBe("github");
  expect(writes).toHaveLength(1);
  expect(writes[0]?.value).toContain(secret);
  expect(deletes).toEqual([
    "/context-use/abcdef123456/production/internal-requests/nango-11111111111111111111111111111111",
  ]);
  const commandText = remoteCommands.join("\n");
  expect(commandText).toContain("NANGO_INTEGRATION_MANAGER_API_KEY");
  expect(commandText).not.toContain(secret);
  expect(commandText).not.toContain(config.nangoHostname);
  expect(commandText).not.toContain("Bearer ");
});

test("SSM request envelopes are bounded to the Standard 4 KiB limit", async () => {
  let writes = 0;
  const fetcher = createInternalNangoFetcher(config, data, "i-123abc", "integration-manager", {
    listRequests: noStaleRequests,
    putRequest: async () => { writes += 1; },
  });
  await expect(fetcher("https://nango.context.example.com/integrations", {
    method: "POST",
    body: JSON.stringify({
      provider: "github",
      unique_key: "github",
      display_name: "GitHub",
      forward_webhooks: false,
      credentials: {
        type: "OAUTH2",
        client_id: "github-client",
        client_secret: "x".repeat(4_096),
        scopes: "repo",
      },
    }),
  })).rejects.toThrow("SSM Standard 4 KiB limit");
  expect(writes).toBe(0);
});

test("internal Nango requests reject SSRF, broad routes, and caller-supplied authorization", async () => {
  let writes = 0;
  const fetcher = createInternalNangoFetcher(config, data, "i-123abc", "integration-manager", {
    listRequests: noStaleRequests,
    putRequest: async () => { writes += 1; },
  });
  await expect(fetcher("https://attacker.example.com/integrations/github")).rejects.toThrow("configured Nango origin");
  await expect(fetcher("https://nango.context.example.com/records")).rejects.toThrow("access denied");
  await expect(fetcher("https://nango.context.example.com/integrations/github", {
    headers: { Authorization: "Bearer attacker" },
  })).rejects.toThrow("header authorization is not allowed");
  await expect(fetcher("https://nango.context.example.com/connections/metadata", {
    method: "POST",
    body: JSON.stringify({
      provider_config_key: "agent-conversations",
      connection_id: "agent-sync",
      metadata: { arbitrary_secret: "must-not-be-stored" },
    }),
  })).rejects.toThrow("request body denied");
  expect(writes).toBe(0);
});

test("internal Nango requests forward cancellation and remove their encrypted request", async () => {
  const deleted: string[] = [];
  const controller = new AbortController();
  const fetcher = createInternalNangoFetcher(config, data, "i-123abc", "dashboard", {
    requestId: () => "2".repeat(32),
    listRequests: noStaleRequests,
    putRequest: async () => {},
    deleteRequest: async (_profile, _region, name) => { deleted.push(name); },
    sendCommands: async (_profile, _region, _instance, _commands, options) => {
      expect(options?.signal).toBe(controller.signal);
      return new Promise((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      });
    },
  });
  const request = fetcher("https://nango.context.example.com/api/v1/user", { signal: controller.signal });
  await Promise.resolve();
  controller.abort();
  await expect(request).rejects.toMatchObject({ name: "AbortError" });
  expect(deleted).toEqual([
    "/context-use/abcdef123456/production/internal-requests/nango-22222222222222222222222222222222",
  ]);
});

test("stale request cleanup deletes only exact encrypted request children older than one hour", async () => {
  const now = Date.parse("2026-08-05T12:00:00Z");
  const prefix = "/context-use/abcdef123456/production/internal-requests";
  const old = `${prefix}/nango-${"a".repeat(32)}`;
  const recent = `${prefix}/nango-${"b".repeat(32)}`;
  const deleted: string[] = [];
  expect(await cleanupStaleNangoRequestParameters("owner", "eu-west-2", prefix, {
    now: () => now,
    listRequests: async () => [
      { Name: old, LastModifiedDate: "2026-08-05T10:00:00Z" },
      { Name: recent, LastModifiedDate: "2026-08-05T11:30:00Z" },
      { Name: `${prefix}/not-a-nango-request`, LastModifiedDate: "2026-08-05T10:00:00Z" },
      { Name: `${prefix}/nested/nango-${"c".repeat(32)}`, LastModifiedDate: "2026-08-05T10:00:00Z" },
    ],
    deleteRequest: async (_profile, _region, name) => { deleted.push(name); },
  })).toEqual([old]);
  expect(deleted).toEqual([old]);
});

test("Nango readiness is checked inside the container without a public route", async () => {
  let commands: string[] = [];
  expect(await probeInternalNangoReady(config, "i-123abc", {
    sendCommands: async (_profile, _region, _instance, input) => {
      commands = input;
      return "CONTEXT_USE_NANGO_READY\n";
    },
  })).toBe(true);
  expect(commands.join("\n")).toContain("127.0.0.1:3003/ready");
  expect(commands.join("\n")).not.toContain(config.nangoHostname);
});

test("the external Nango boundary checks redirects, private routes, and real credential bypasses", async () => {
  const commands = externalNangoBoundaryCommands(config);
  const text = commands.join("\n");
  expect(text).toContain("--resolve 'nango.context.example.com:443:127.0.0.1'");
  expect(text).toContain("/_context-use-auth/start?rd=https://nango.context.example.com/");
  for (const path of ["/ready", "/api/v1/environment/api-keys?env=prod", "/records", "/connections", "/scripts/config"]) {
    expect(text).toContain(path);
  }
  expect(text).toContain("NANGO_DASHBOARD_PASSWORD");
  expect(text).toContain("NANGO_INTEGRATION_MANAGER_API_KEY");
  expect(text).toContain("/connections?integrationId=github&limit=25&page=0");
  expect(text).toContain("*[!A-Za-z0-9_-]*");
  expect(text).toContain("--config /dev/stdin");
  expect(text).not.toContain("--user");
  expect(text).not.toContain("--header 'Authorization");
  expect(commands.at(-1)).toBe("echo 'CONTEXT_USE_NANGO_BOUNDARY_OK'");

  const beforeKeyProvisioning = externalNangoBoundaryCommands(config, { requireManagedApiKey: false }).join("\n");
  expect(beforeKeyProvisioning).toContain("NANGO_DASHBOARD_PASSWORD");
  expect(beforeKeyProvisioning).not.toContain("NANGO_INTEGRATION_MANAGER_API_KEY");

  let sent: string[] = [];
  expect(await verifyExternalNangoBoundary(config, "i-123abc", {
    sendCommands: async (_profile, _region, _instance, input) => {
      sent = input;
      return "CONTEXT_USE_NANGO_BOUNDARY_OK\n";
    },
  })).toBe(true);
  expect(sent).toEqual(commands);
  await expect(verifyExternalNangoBoundary(config, "i-123abc", {
    sendCommands: async () => "302 arbitrary-output",
  })).rejects.toThrow("invalid response");
});

test("internal request commands reject parameter injection and contain valid remote code", () => {
  expect(() => internalNangoRequestCommands({
    access: "integration-manager",
    requestParameter: "/context-use/abcdef123456/production/internal-requests/nango-123;touch",
    method: "GET",
    path: "/scripts/config",
    apiKeyParameter: "/context-use/abcdef123456/production/NANGO_INTEGRATION_MANAGER_API_KEY",
  })).toThrow("Invalid internal Nango request parameter");
  const source = decodedRemoteSource();
  expect(() => new Function(source)).not.toThrow();
  expect(source).toContain("request.method !== expectedMethod");
  expect(source).toContain("request.path !== expectedPath");
  expect(source).toContain("assertRequestBody(request, requestUrl)");
});
