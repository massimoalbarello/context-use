import { expect, test } from "bun:test";
import { formatNangoCredentials } from "./commands/nango/credentials.ts";
import { ensureNangoApiKeys, verifyNangoDashboardAuthentication } from "./nango.ts";
import { generateNangoEncryptionKey } from "./setup.ts";
import type { DataOutputs, DeploymentConfig } from "./types.ts";

const config: DeploymentConfig = {
  schemaVersion: 2,
  releaseVersion: "v0.1.47",
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
  kms_key_arn: "arn:aws:kms:eu-west-2:123456789012:key/data",
  kms_key_id: "data",
  data_volume_id: "vol-data",
  asset_bucket: "assets",
  backup_bucket: "backups",
};

function apiKey(id: number, displayName: string, scopes: string[], secret: string) {
  return { id, display_name: displayName, scopes, secret };
}

test("Nango's encryption key is exactly 256 bits encoded as standard base64", () => {
  const key = generateNangoEncryptionKey();
  expect(key).toMatch(/^[A-Za-z0-9+/]{43}=$/);
  expect(Buffer.from(key, "base64")).toHaveLength(32);
});

test("Nango dashboard credentials stay masked unless explicitly revealed", () => {
  expect(formatNangoCredentials("https://nango.example.com", "owner@example.com", null))
    .toContain("Password: ******** (use --reveal to show)");
  expect(formatNangoCredentials("https://nango.example.com", "owner@example.com", "dashboard-secret"))
    .toContain("Password: dashboard-secret");
});

test("Nango dashboard authentication rejects anonymous access and accepts only its Basic credentials", async () => {
  const requests: Array<string | null> = [];
  const fetcher = async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const authorization = new Headers(init?.headers).get("Authorization");
    requests.push(authorization);
    return authorization ? Response.json({ data: { id: 0 } }) : Response.json({}, { status: 401 });
  };
  const verified = await verifyNangoDashboardAuthentication(config, {
    fetcher: fetcher as typeof fetch,
    readParameter: async (_profile, _region, name) => name.endsWith("USERNAME") ? "owner@example.com" : "dashboard-password",
  });

  expect(verified).toBe(true);
  expect(requests).toEqual([
    null,
    `Basic ${Buffer.from("owner@example.com:dashboard-password").toString("base64")}`,
  ]);

  await expect(verifyNangoDashboardAuthentication(config, {
    fetcher: (async () => Response.json({ data: {} })) as unknown as typeof fetch,
    readParameter: async () => "unused",
  })).rejects.toThrow("expected 401");
});

test("Nango API key bootstrap creates least-privilege keys and stores their secrets", async () => {
  const parameters = new Map<string, string>([
    ["/context-use/abcdef123456/production/NANGO_DASHBOARD_USERNAME", "owner@example.com"],
    ["/context-use/abcdef123456/production/NANGO_DASHBOARD_PASSWORD", "dashboard-password"],
  ]);
  const requests: Array<{ url: string; method: string; body?: unknown; authorization: string | null }> = [];
  let nextId = 1;
  const fetcher = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const body = init?.body ? JSON.parse(String(init.body)) as { display_name: string; scopes: string[] } : undefined;
    requests.push({
      url: input.toString(),
      method: init?.method ?? "GET",
      ...(body ? { body } : {}),
      authorization: new Headers(init?.headers).get("Authorization"),
    });
    if (!body) return Response.json({ data: [] });
    return Response.json({ data: apiKey(nextId++, body.display_name, body.scopes, `${body.display_name}-secret`) });
  };

  await ensureNangoApiKeys(config, data, {
    fetcher: fetcher as typeof fetch,
    readParameter: async (_profile, _region, name) => parameters.get(name) ?? (() => { throw new Error("missing"); })(),
    readParameterIfPresent: async (_profile, _region, name) => parameters.get(name) ?? null,
    writeParameter: async (_profile, _region, name, value, kmsKeyId) => {
      expect(kmsKeyId).toBe(data.kms_key_arn);
      parameters.set(name, value);
    },
  });

  expect(requests.map((request) => request.method)).toEqual(["GET", "POST", "POST", "POST"]);
  expect(requests.every((request) => request.authorization === `Basic ${Buffer.from("owner@example.com:dashboard-password").toString("base64")}`)).toBe(true);
  expect(requests.every((request) => request.url.endsWith("?env=prod"))).toBe(true);
  expect(requests[1]?.body).toEqual({
    display_name: "context-use-deployer",
    scopes: ["environment:deploy"],
  });
  expect(requests[2]?.body).toEqual({
    display_name: "context-use-pipeline",
    scopes: [
      "environment:records:read",
      "environment:connections:list",
    ],
  });
  expect(requests[3]?.body).toEqual({
    display_name: "context-use-integration-manager",
    scopes: [
      "environment:integrations:read",
      "environment:integrations:create",
      "environment:integrations:update",
      "environment:connections:list",
      "environment:connections:read",
      "environment:connections:create",
      "environment:connections:update",
      "environment:integrations:list_functions",
    ],
  });
  expect(parameters.get("/context-use/abcdef123456/production/NANGO_DEPLOYER_API_KEY")).toBe("context-use-deployer-secret");
  expect(parameters.get("/context-use/abcdef123456/production/NANGO_PIPELINE_API_KEY")).toBe("context-use-pipeline-secret");
  expect(parameters.get("/context-use/abcdef123456/production/NANGO_INTEGRATION_MANAGER_API_KEY")).toBe("context-use-integration-manager-secret");
});

test("Nango API key bootstrap reconciles scopes without rotating an existing key", async () => {
  const prefix = "/context-use/abcdef123456/production";
  const parameters = new Map<string, string>([
    [`${prefix}/NANGO_DASHBOARD_USERNAME`, "owner@example.com"],
    [`${prefix}/NANGO_DASHBOARD_PASSWORD`, "dashboard-password"],
    [`${prefix}/NANGO_PIPELINE_API_KEY`, "stored-pipeline-secret"],
  ]);
  const methods: string[] = [];
  const fetcher = async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? "GET";
    methods.push(method);
    if (method === "GET") {
      return Response.json({
        data: [
          apiKey(1, "context-use-deployer", ["environment:deploy"], "deployer-secret"),
          apiKey(2, "context-use-pipeline", ["environment:records:read"], "****abcd"),
          apiKey(3, "context-use-integration-manager", [
            "environment:integrations:read",
            "environment:integrations:create",
            "environment:integrations:update",
            "environment:connections:list",
            "environment:connections:read",
            "environment:connections:create",
            "environment:connections:update",
            "environment:integrations:list_functions",
          ], "manager-secret"),
        ],
      });
    }
    return Response.json({ success: true });
  };

  await ensureNangoApiKeys(config, data, {
    fetcher: fetcher as typeof fetch,
    readParameter: async (_profile, _region, name) => parameters.get(name) ?? (() => { throw new Error("missing"); })(),
    readParameterIfPresent: async (_profile, _region, name) => parameters.get(name) ?? null,
    writeParameter: async (_profile, _region, name, value) => { parameters.set(name, value); },
  });

  expect(methods).toEqual(["GET", "PATCH"]);
  expect(parameters.get(`${prefix}/NANGO_DEPLOYER_API_KEY`)).toBe("deployer-secret");
  expect(parameters.get(`${prefix}/NANGO_PIPELINE_API_KEY`)).toBe("stored-pipeline-secret");
  expect(parameters.get(`${prefix}/NANGO_INTEGRATION_MANAGER_API_KEY`)).toBe("manager-secret");
});

test("Nango API key bootstrap fails safely when the only copy of a secret is masked", async () => {
  const prefix = "/context-use/abcdef123456/production";
  await expect(ensureNangoApiKeys(config, data, {
    fetcher: (async () => Response.json({
      data: [
        apiKey(1, "context-use-deployer", ["environment:deploy"], "****abcd"),
      ],
    })) as unknown as typeof fetch,
    readParameter: async (_profile, _region, name) => name.endsWith("USERNAME") ? "owner@example.com" : "password",
    readParameterIfPresent: async () => null,
    writeParameter: async () => {},
  })).rejects.toThrow("Restore that SSM parameter");
  expect(prefix).toContain(config.installationId);
});
