import { expect, test } from "bun:test";
import { MANAGED_INTEGRATIONS } from "../../../nango-integrations/catalog.ts";
import { deployManagedNangoFunctions } from "./nango-integration-deployment.ts";
import {
  getNangoIntegration,
  nangoFunctionDeploymentCommands,
  readManagedIntegrationStatus,
  reconcileNangoIntegration,
} from "./nango-integrations.ts";
import type { DeploymentConfig } from "./types.ts";

const baseUrl = "https://nango.example.com";
const apiKey = "manager-secret";
const github = MANAGED_INTEGRATIONS[0];
const granola = MANAGED_INTEGRATIONS[1];
const digest = "a".repeat(64);
const image = `ghcr.io/massimoalbarello/context-use-nango@sha256:${digest}`;

function integration(provider = "github") {
  return {
    unique_key: "github",
    provider,
    display_name: "GitHub",
    forward_webhooks: false,
  };
}

test("GitHub integration creation sends OAuth credentials directly to Nango", async () => {
  const requests: Array<{ path: string; method: string; authorization: string | null; body?: unknown }> = [];
  const fetcher = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input.toString());
    requests.push({
      path: url.pathname,
      method: init?.method ?? "GET",
      authorization: new Headers(init?.headers).get("Authorization"),
      ...(init?.body ? { body: JSON.parse(String(init.body)) as unknown } : {}),
    });
    if ((init?.method ?? "GET") === "GET") return Response.json({}, { status: 404 });
    return Response.json({ data: integration() });
  };

  const result = await reconcileNangoIntegration(
    baseUrl,
    apiKey,
    github,
    { clientId: "github-client", clientSecret: "github-secret" },
    { fetcher: fetcher as typeof fetch, pause: async () => {} },
  );

  expect(result.outcome).toBe("created");
  expect(requests).toHaveLength(2);
  expect(requests.every((request) => request.authorization === `Bearer ${apiKey}`)).toBe(true);
  expect(requests[1]).toMatchObject({
    path: "/integrations",
    method: "POST",
    body: {
      provider: "github",
      unique_key: "github",
      display_name: "GitHub",
      forward_webhooks: false,
      credentials: {
        type: "OAUTH2",
        client_id: "github-client",
        client_secret: "github-secret",
        scopes: "repo",
      },
    },
  });
});

test("Granola integration creation is left to the dashboard MCP registration flow", async () => {
  let requests = 0;
  await expect(reconcileNangoIntegration(baseUrl, apiKey, granola, undefined, {
    fetcher: (async () => {
      requests += 1;
      return Response.json({}, { status: 404 });
    }) as unknown as typeof fetch,
  })).rejects.toThrow("must be created in the Nango dashboard");
  expect(requests).toBe(1);
});

test("existing GitHub credentials are preserved unless reconfiguration is explicit", async () => {
  const methods: string[] = [];
  const bodies: unknown[] = [];
  const fetcher = async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    methods.push(init?.method ?? "GET");
    if (init?.body) bodies.push(JSON.parse(String(init.body)) as unknown);
    return Response.json({ data: integration() });
  };

  const unchanged = await reconcileNangoIntegration(baseUrl, apiKey, github, undefined, {
    fetcher: fetcher as typeof fetch,
  });
  expect(unchanged.outcome).toBe("unchanged");
  expect(methods).toEqual(["GET"]);

  const rotated = await reconcileNangoIntegration(
    baseUrl,
    apiKey,
    github,
    { clientId: "replacement-client", clientSecret: "replacement-secret" },
    { fetcher: fetcher as typeof fetch },
  );
  expect(rotated.outcome).toBe("updated");
  expect(methods).toEqual(["GET", "GET", "PATCH"]);
  expect(bodies[0]).toMatchObject({
    credentials: {
      client_id: "replacement-client",
      client_secret: "replacement-secret",
    },
  });
});

test("a conflicting Nango provider is rejected without mutation", async () => {
  let requests = 0;
  await expect(reconcileNangoIntegration(baseUrl, apiKey, github, undefined, {
    fetcher: (async () => {
      requests += 1;
      return Response.json({ data: integration("gitlab") });
    }) as unknown as typeof fetch,
  })).rejects.toThrow("uses provider gitlab; expected github");
  expect(requests).toBe(1);
});

test("Nango API failures do not echo OAuth credentials", async () => {
  const secret = "never-print-this-secret";
  const fetcher = async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if ((init?.method ?? "GET") === "GET") return Response.json({ data: integration() });
    return Response.json({ error: { message: secret } }, { status: 400 });
  };
  try {
    await reconcileNangoIntegration(
      baseUrl,
      apiKey,
      github,
      { clientId: "replacement", clientSecret: secret },
      { fetcher: fetcher as typeof fetch },
    );
    throw new Error("Expected reconfiguration to fail");
  } catch (error) {
    expect(String(error)).not.toContain(secret);
    expect(String(error)).toContain("HTTP 400");
  }
});

test("managed status reports every GitHub connection and the deployed release", async () => {
  const fetcher = async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(input.toString());
    if (url.pathname === "/integrations/github") return Response.json({ data: integration() });
    if (url.pathname === "/connections") {
      expect(url.searchParams.get("integrationId")).toBe("github");
      expect(url.searchParams.get("page")).toBe("0");
      return Response.json({ connections: [
        { connection_id: "personal", provider_config_key: "github" },
        { connection_id: "work", provider_config_key: "github" },
      ] });
    }
    if (url.pathname === "/scripts/config") {
      return Response.json([{
        providerConfigKey: "github",
        syncs: [{ name: "pull-requests", type: "sync", runs: "every half hour", version: "v1.2.3" }],
        actions: [],
        "on-events": [],
      }]);
    }
    return Response.json({}, { status: 404 });
  };

  const status = await readManagedIntegrationStatus(baseUrl, apiKey, "github", "pull-requests", {
    fetcher: fetcher as typeof fetch,
  });
  expect(status.configured).toBe(true);
  expect(status.connections.map((connection) => connection.connection_id)).toEqual(["personal", "work"]);
  expect(status.sync?.version).toBe("v1.2.3");
});

test("remote function deployment is digest-pinned, least-privilege, and single-sync scoped", () => {
  const parameter = "/context-use/abcdef123456/production/NANGO_DEPLOYER_API_KEY";
  const commands = nangoFunctionDeploymentCommands({
    image,
    releaseVersion: "v1.2.3",
    deployerKeyParameter: parameter,
    integrationId: "github",
    syncName: "pull-requests",
  });
  const joined = commands.join("\n");

  expect(joined).toContain(`docker pull '${image}'`);
  expect(joined).toContain("--network context-use_nango_web");
  expect(joined).toContain("--read-only");
  expect(joined).toContain("--cap-drop ALL");
  expect(joined).toContain("--security-opt no-new-privileges");
  expect(joined).toContain("-e NANGO_SECRET_KEY_PROD");
  expect(joined).not.toContain("manager-secret");
  expect(joined).toContain("--integration 'github' --sync 'pull-requests'");
  expect(joined).toContain("--version 'v1.2.3'");
  expect(joined).not.toContain("--allow-destructive");

  expect(nangoFunctionDeploymentCommands({
    image,
    releaseVersion: "v1.2.3",
    deployerKeyParameter: parameter,
    integrationId: "github",
    syncName: "pull-requests",
    allowDestructive: true,
  }).join("\n")).toContain("--allow-destructive");

  expect(() => nangoFunctionDeploymentCommands({
    image: "ghcr.io/massimoalbarello/context-use-nango:integrations-latest",
    releaseVersion: "v1.2.3",
    deployerKeyParameter: parameter,
    integrationId: "github",
    syncName: "pull-requests",
  })).toThrow("Invalid Nango integrations image");
  expect(() => nangoFunctionDeploymentCommands({
    image,
    releaseVersion: "v1.2.3'; echo unsafe",
    deployerKeyParameter: parameter,
    integrationId: "github",
    syncName: "pull-requests",
  })).toThrow("Invalid Context Use release version");
});

test("managed deployment uses the installed release image and never resolves latest", async () => {
  const config = {
    schemaVersion: 2,
    releaseVersion: "v1.2.3",
    environment: "production",
    installationId: "abcdef123456",
    awsProfile: "default",
    awsRegion: "eu-west-2",
  } as DeploymentConfig;
  const calls: Array<{ profile: string; region: string; instance: string; commands: string[] }> = [];
  const result = await deployManagedNangoFunctions(config, "/release/v1.2.3", "i-123", false, {
    readImages: async (root) => {
      expect(root).toBe("/release/v1.2.3");
      return { nango: "unused", nangoIntegrations: image };
    },
    sendCommands: async (profile, region, instance, commands) => {
      calls.push({ profile, region, instance, commands });
      return "deployed";
    },
  });
  expect(result).toEqual([
    { integrationId: "github", functionName: "pull-requests", output: "deployed" },
    { integrationId: "granola", functionName: "meetings", output: "deployed" },
  ]);
  expect(calls).toHaveLength(2);
  expect(calls[0]?.commands.join("\n")).toContain("--version 'v1.2.3'");
});

test("missing integrations return an empty status without querying connections or functions", async () => {
  let requests = 0;
  const status = await readManagedIntegrationStatus(baseUrl, apiKey, "github", "pull-requests", {
    fetcher: (async () => {
      requests += 1;
      return Response.json({}, { status: 404 });
    }) as unknown as typeof fetch,
  });
  expect(status).toEqual({ configured: false, connections: [], sync: null });
  expect(requests).toBe(1);
  expect(await getNangoIntegration(baseUrl, apiKey, "github", {
    fetcher: (async () => Response.json({}, { status: 404 })) as unknown as typeof fetch,
  })).toBeNull();
});
