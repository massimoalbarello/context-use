import { z } from "zod";
import type { MANAGED_INTEGRATIONS } from "../../../nango-integrations/catalog.ts";

const integrationSchema = z.object({
  unique_key: z.string().min(1),
  provider: z.string().min(1),
  display_name: z.string().nullable().optional(),
  forward_webhooks: z.boolean(),
}).passthrough();

const integrationResponseSchema = z.object({ data: integrationSchema });
const connectionSchema = z.object({
  connection_id: z.string().min(1),
  provider_config_key: z.string().min(1),
}).passthrough();
const connectionsResponseSchema = z.object({ connections: z.array(connectionSchema) });
const scriptSchema = z.object({
  name: z.string().min(1),
  type: z.string().optional(),
  runs: z.string().nullable().optional(),
  version: z.string().nullable().optional(),
  last_deployed: z.string().nullable().optional(),
}).passthrough();
const scriptsConfigSchema = z.array(z.object({
  providerConfigKey: z.string().min(1),
  syncs: z.array(scriptSchema),
  actions: z.array(scriptSchema),
  "on-events": z.array(scriptSchema),
}).passthrough());

const integrationsImagePattern = /^ghcr\.io\/massimoalbarello\/context-use-nango@sha256:[a-f0-9]{64}$/;
const identifierPattern = /^[a-z][a-z0-9_-]{0,254}$/;
const releasePattern = /^v\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/;
const parameterPattern = /^\/context-use\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/NANGO_DEPLOYER_API_KEY$/;
const retryableStatuses = new Set([429, 500, 502, 503, 504]);

type ManagedIntegration = (typeof MANAGED_INTEGRATIONS)[number];
type NangoIntegration = z.infer<typeof integrationSchema>;
type NangoConnection = z.infer<typeof connectionSchema>;
type NangoScript = z.infer<typeof scriptSchema>;

export type NangoApiDependencies = {
  fetcher?: typeof fetch;
  pause?: (milliseconds: number) => Promise<void>;
};

export type GitHubOAuthCredentials = {
  clientId: string;
  clientSecret: string;
};

export type IntegrationReconcileResult = {
  integration: NangoIntegration;
  outcome: "created" | "updated" | "unchanged";
};

export type ManagedIntegrationStatus = {
  configured: boolean;
  connections: NangoConnection[];
  sync: NangoScript | null;
};

class NangoHttpError extends Error {
  constructor(
    readonly status: number,
    method: string,
    path: string,
  ) {
    super(`Nango API request failed: ${method} ${path} returned HTTP ${status}`);
  }
}

function apiUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

async function requestJson(
  baseUrl: string,
  apiKey: string,
  path: string,
  init: RequestInit,
  dependencies: NangoApiDependencies,
  retry = true,
): Promise<unknown> {
  const fetcher = dependencies.fetcher ?? fetch;
  const pause = dependencies.pause ?? ((milliseconds: number) => Bun.sleep(milliseconds));
  const method = init.method ?? "GET";
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  headers.set("Authorization", `Bearer ${apiKey}`);
  if (init.body !== undefined) headers.set("Content-Type", "application/json");

  for (let attempt = 0; attempt < 3; attempt += 1) {
    let response: Response;
    try {
      response = await fetcher(apiUrl(baseUrl, path), {
        ...init,
        headers,
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      if (!retry || attempt === 2) {
        throw new Error(`Nango API request failed: ${method} ${path} could not be completed`);
      }
      await pause(250 * (2 ** attempt));
      continue;
    }

    if (!response.ok) {
      if (retry && retryableStatuses.has(response.status) && attempt < 2) {
        await pause(250 * (2 ** attempt));
        continue;
      }
      throw new NangoHttpError(response.status, method, path);
    }

    try {
      return await response.json();
    } catch {
      throw new Error(`Nango API request failed: ${method} ${path} returned invalid JSON`);
    }
  }

  throw new Error(`Nango API request failed: ${method} ${path} exhausted its retries`);
}

export async function getNangoIntegration(
  baseUrl: string,
  apiKey: string,
  integrationId: string,
  dependencies: NangoApiDependencies = {},
): Promise<NangoIntegration | null> {
  try {
    return integrationResponseSchema.parse(await requestJson(
      baseUrl,
      apiKey,
      `/integrations/${encodeURIComponent(integrationId)}`,
      { method: "GET" },
      dependencies,
    )).data;
  } catch (error) {
    if (error instanceof NangoHttpError && error.status === 404) return null;
    throw error;
  }
}

function assertProvider(integration: NangoIntegration, spec: ManagedIntegration): void {
  if (integration.provider !== spec.provider) {
    throw new Error(
      `Nango integration ${spec.id} uses provider ${integration.provider}; expected ${spec.provider}. `
      + "Resolve the conflicting integration in the Nango dashboard before continuing.",
    );
  }
}

function oauthBody(spec: ManagedIntegration, credentials: GitHubOAuthCredentials) {
  if (!credentials.clientId.trim() || !credentials.clientSecret.trim()) {
    throw new Error(`${spec.displayName} OAuth client ID and secret are required`);
  }
  return {
    type: "OAUTH2" as const,
    client_id: credentials.clientId.trim(),
    client_secret: credentials.clientSecret.trim(),
    scopes: spec.oauth.scopes.join(","),
  };
}

export async function reconcileNangoIntegration(
  baseUrl: string,
  apiKey: string,
  spec: ManagedIntegration,
  credentials: GitHubOAuthCredentials | undefined,
  dependencies: NangoApiDependencies = {},
): Promise<IntegrationReconcileResult> {
  const existing = await getNangoIntegration(baseUrl, apiKey, spec.id, dependencies);
  if (existing) {
    assertProvider(existing, spec);
    const mutableDrift = existing.display_name !== spec.displayName
      || existing.forward_webhooks !== spec.forwardWebhooks;
    if (!mutableDrift && !credentials) return { integration: existing, outcome: "unchanged" };

    const body = {
      display_name: spec.displayName,
      forward_webhooks: spec.forwardWebhooks,
      ...(credentials ? { credentials: oauthBody(spec, credentials) } : {}),
    };
    const updated = integrationResponseSchema.parse(await requestJson(
      baseUrl,
      apiKey,
      `/integrations/${encodeURIComponent(spec.id)}`,
      { method: "PATCH", body: JSON.stringify(body) },
      dependencies,
    )).data;
    assertProvider(updated, spec);
    return { integration: updated, outcome: "updated" };
  }

  if (!credentials) throw new Error(`${spec.displayName} OAuth credentials are required to create the integration`);
  const body = {
    provider: spec.provider,
    unique_key: spec.id,
    display_name: spec.displayName,
    forward_webhooks: spec.forwardWebhooks,
    credentials: oauthBody(spec, credentials),
  };
  try {
    const created = integrationResponseSchema.parse(await requestJson(
      baseUrl,
      apiKey,
      "/integrations",
      { method: "POST", body: JSON.stringify(body) },
      dependencies,
      false,
    )).data;
    assertProvider(created, spec);
    return { integration: created, outcome: "created" };
  } catch (error) {
    // A timed-out POST may have committed. Re-read before asking the user to
    // retry so onboarding remains idempotent without blindly duplicating it.
    const reconciled = await getNangoIntegration(baseUrl, apiKey, spec.id, dependencies);
    if (!reconciled) throw error;
    assertProvider(reconciled, spec);
    return { integration: reconciled, outcome: "created" };
  }
}

async function listNangoConnections(
  baseUrl: string,
  apiKey: string,
  integrationId: string,
  dependencies: NangoApiDependencies,
): Promise<NangoConnection[]> {
  const connections: NangoConnection[] = [];
  for (let page = 0; ; page += 1) {
    const query = new URLSearchParams({ integrationId, limit: "100", page: String(page) });
    const result = connectionsResponseSchema.parse(await requestJson(
      baseUrl,
      apiKey,
      `/connections?${query.toString()}`,
      { method: "GET" },
      dependencies,
    ));
    connections.push(...result.connections);
    if (result.connections.length < 100) return connections;
  }
}

export async function readManagedIntegrationStatus(
  baseUrl: string,
  apiKey: string,
  integrationId: string,
  syncName: string,
  dependencies: NangoApiDependencies = {},
): Promise<ManagedIntegrationStatus> {
  const integration = await getNangoIntegration(baseUrl, apiKey, integrationId, dependencies);
  if (!integration) return { configured: false, connections: [], sync: null };

  const [connections, configs] = await Promise.all([
    listNangoConnections(baseUrl, apiKey, integrationId, dependencies),
    requestJson(baseUrl, apiKey, "/scripts/config", { method: "GET" }, dependencies)
      .then((value) => scriptsConfigSchema.parse(value)),
  ]);
  const config = configs.find((candidate) => candidate.providerConfigKey === integrationId);
  return {
    configured: true,
    connections,
    sync: config?.syncs.find((candidate) => candidate.name === syncName) ?? null,
  };
}

export type NangoFunctionDeployment = {
  image: string;
  releaseVersion: string;
  deployerKeyParameter: string;
  integrationId: string;
  syncName: string;
  allowDestructive?: boolean;
};

export function nangoFunctionDeploymentCommands(input: NangoFunctionDeployment): string[] {
  if (!integrationsImagePattern.test(input.image)) throw new Error("Invalid Nango integrations image");
  if (!releasePattern.test(input.releaseVersion)) throw new Error("Invalid Context Use release version");
  if (!parameterPattern.test(input.deployerKeyParameter)) throw new Error("Invalid Nango deployer key parameter");
  if (!identifierPattern.test(input.integrationId)) throw new Error("Invalid Nango integration ID");
  if (!identifierPattern.test(input.syncName)) throw new Error("Invalid Nango sync name");

  const deploy = [
    "docker run --rm",
    "--network context-use_nango_web",
    "--read-only",
    "--tmpfs /tmp:rw,noexec,nosuid,size=64m,mode=1777,uid=1000,gid=1000",
    "--tmpfs /opt/context-use/nango-integrations/build:rw,noexec,nosuid,size=256m,mode=0700,uid=1000,gid=1000",
    "--tmpfs /opt/context-use/nango-integrations/.nango:rw,noexec,nosuid,size=32m,mode=0700,uid=1000,gid=1000",
    "--cap-drop ALL",
    "--security-opt no-new-privileges",
    "--pids-limit 256",
    "-e NANGO_SECRET_KEY_PROD",
    "-e NANGO_HOSTPORT=http://nango-server:3003",
    "-e NANGO_CLI_UPGRADE_MODE=ignore",
    "-e NANGO_CLI_DEPENDENCY_UPDATE=false",
    "-e NANGO_CLI_TELEMETRY=false",
    "-e XDG_CONFIG_HOME=/tmp/.config",
    "-e CI=1",
    `'${input.image}'`,
    "deploy prod",
    `--integration '${input.integrationId}'`,
    `--sync '${input.syncName}'`,
    `--version '${input.releaseVersion}'`,
    "--auto-confirm",
    "--no-interactive",
    "--no-dependency-update",
    "--no-telemetry",
    ...(input.allowDestructive ? ["--allow-destructive"] : []),
  ].join(" ");

  return [
    `docker pull '${input.image}' >/dev/null`,
    `export NANGO_SECRET_KEY_PROD="$(aws ssm get-parameter --name '${input.deployerKeyParameter}' --with-decryption --query Parameter.Value --output text)"`,
    "trap 'unset NANGO_SECRET_KEY_PROD' EXIT",
    deploy,
    "unset NANGO_SECRET_KEY_PROD",
    "trap - EXIT",
  ];
}
