import { randomBytes } from "node:crypto";
import { z } from "zod";
import {
  awsJson,
  deleteSecureParameter,
  putSecureParameter,
  sendSsmCommands,
} from "./aws.ts";
import type { DataOutputs, DeploymentConfig } from "./types.ts";

export type InternalNangoAccess = "anonymous" | "dashboard" | "integration-manager";

type PutRequest = typeof putSecureParameter;
type DeleteRequest = typeof deleteSecureParameter;
type SendCommands = typeof sendSsmCommands;
type ListRequests = (profile: string, region: string, prefix: string) => Promise<Array<{
  Name?: string;
  LastModifiedDate?: string | number;
}>>;

export type InternalNangoDependencies = {
  putRequest?: PutRequest;
  deleteRequest?: DeleteRequest;
  sendCommands?: SendCommands;
  requestId?: () => string;
  listRequests?: ListRequests;
  now?: () => number;
};

const responseSchema = z.object({
  status: z.number().int().min(100).max(599),
  statusText: z.string(),
  contentType: z.string().nullable(),
  body: z.string(),
});

const identifierPattern = /^[a-z][a-z0-9_-]{0,254}$/;
const requestParameterPattern = /^\/context-use\/[a-z0-9-]+\/[a-z0-9-]+\/internal-requests\/nango-[a-f0-9]{32}$/;
const apiKeyParameterPattern = /^\/context-use\/[a-z0-9-]+\/[a-z0-9-]+\/NANGO_INTEGRATION_MANAGER_API_KEY$/;
const responseMarker = "CONTEXT_USE_NANGO_RESPONSE:";
const maximumParameterValueBytes = 4_096;
const maximumResponseBytes = 8 * 1_024;
export const NANGO_CONNECTION_PAGE_SIZE = 25;
const managedIntegrations = {
  github: { provider: "github", displayName: "GitHub", create: true, oauth: true },
  granola: { provider: "granola-mcp", displayName: "Granola", create: false, oauth: false },
  "agent-conversations": {
    provider: "authenticated-webhook",
    displayName: "Agent Conversations",
    create: true,
    oauth: false,
  },
} as const;
const managedIntegrationIds = new Set(Object.keys(managedIntegrations));
const requestPrefixPattern = /^\/context-use\/[a-z0-9-]+\/[a-z0-9-]+\/internal-requests$/;
const agentSyncConnectionPattern = /^agent-sync(?:-([a-f0-9]{32}))?$/;

function agentSyncInstanceId(connectionId: unknown): string | null | undefined {
  if (typeof connectionId !== "string") return undefined;
  const match = connectionId.match(agentSyncConnectionPattern);
  if (!match) return undefined;
  return match[1] ?? null;
}

function hasExactQuery(url: URL, expected: Record<string, string>): boolean {
  const entries = [...url.searchParams.entries()];
  return entries.length === Object.keys(expected).length
    && Object.entries(expected).every(([key, value]) => url.searchParams.getAll(key).length === 1 && url.searchParams.get(key) === value);
}

function identifierPath(pathname: string, prefix: string): string | null {
  if (!pathname.startsWith(prefix)) return null;
  const encoded = pathname.slice(prefix.length);
  if (!encoded || encoded.includes("/")) return null;
  try {
    const value = decodeURIComponent(encoded);
    return identifierPattern.test(value) ? value : null;
  } catch {
    return null;
  }
}

export function assertInternalNangoRoute(access: InternalNangoAccess, method: string, url: URL): void {
  const noQuery = url.search === "";
  if (access === "anonymous") {
    if (method === "GET" && noQuery && url.pathname === "/api/v1/user") return;
  } else if (access === "dashboard") {
    if (method === "GET" && noQuery && url.pathname === "/api/v1/user") return;
  } else {
    const integrationId = identifierPath(url.pathname, "/integrations/");
    if (method === "POST" && noQuery && url.pathname === "/integrations") return;
    if (integrationId && managedIntegrationIds.has(integrationId) && method === "PATCH" && noQuery) return;
    if (integrationId && managedIntegrationIds.has(integrationId) && method === "GET"
      && (noQuery || hasExactQuery(url, { include: "webhook" }))) return;

    const connectionId = identifierPath(url.pathname, "/connections/");
    if (agentSyncInstanceId(connectionId) !== undefined && method === "GET") {
      const provider = url.searchParams.get("provider_config_key");
      if (provider === "agent-conversations" && hasExactQuery(url, { provider_config_key: provider })) return;
    }
    if (method === "GET" && url.pathname === "/connections") {
      const integration = url.searchParams.get("integrationId");
      const page = url.searchParams.get("page");
      if (integration && managedIntegrationIds.has(integration) && page && /^(0|[1-9][0-9]*)$/.test(page)
        && hasExactQuery(url, { integrationId: integration, limit: String(NANGO_CONNECTION_PAGE_SIZE), page })) return;
    }
    if (method === "POST" && noQuery
      && (url.pathname === "/connections" || url.pathname === "/connections/metadata")) return;
    if (method === "GET" && noQuery && url.pathname === "/scripts/config") return;
  }
  throw new Error(`Nango controller access denied for ${method} ${url.pathname}`);
}

function exactObject(value: unknown, keys: string[]): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return Object.keys(record).sort().join("|") === [...keys].sort().join("|") ? record : null;
}

function boundedRequestString(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && !/[\r\n\0]/.test(value);
}

function validAgentMetadata(value: unknown, connectionId: unknown): boolean {
  const instanceId = agentSyncInstanceId(connectionId);
  if (instanceId === undefined) return false;
  const metadata = exactObject(value, [
    "authenticated_webhook",
    "daemon_version",
    "deployment_id",
    "instance_id",
    "label",
    "updated_at",
  ]) ?? exactObject(value, [
    "authenticated_webhook",
    "daemon_version",
    "deployment_id",
    "label",
    "updated_at",
  ]);
  if (!metadata) return false;
  const webhook = exactObject(metadata.authenticated_webhook, ["state", "token_sha256"]);
  return Boolean(
    webhook
    && (webhook.state === "active" || webhook.state === "revoked")
    && typeof webhook.token_sha256 === "string"
    && /^[a-f0-9]{64}$/.test(webhook.token_sha256)
    && boundedRequestString(metadata.deployment_id, 256)
    && boundedRequestString(metadata.label, 256)
    && boundedRequestString(metadata.daemon_version, 128)
    && boundedRequestString(metadata.updated_at, 64)
    && Number.isFinite(Date.parse(metadata.updated_at as string))
    && (instanceId === null
      ? metadata.instance_id === undefined
      : metadata.instance_id === instanceId),
  );
}

function validOauthCredentials(value: unknown): boolean {
  const credentials = exactObject(value, ["type", "client_id", "client_secret", "scopes"]);
  return Boolean(
    credentials
    && credentials.type === "OAUTH2"
    && boundedRequestString(credentials.client_id, 1_024)
    && boundedRequestString(credentials.client_secret, 4_096)
    && credentials.scopes === "repo",
  );
}

export function assertInternalNangoRequestBody(
  access: InternalNangoAccess,
  method: string,
  url: URL,
  body: string | null,
): void {
  if (method === "GET") {
    if (body === null) return;
    throw new Error(`Nango controller request body denied for ${method} ${url.pathname}`);
  }
  if (access !== "integration-manager" || body === null) {
    throw new Error(`Nango controller request body denied for ${method} ${url.pathname}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error(`Nango controller request body denied for ${method} ${url.pathname}`);
  }

  let valid = false;
  if (url.pathname === "/integrations" && method === "POST") {
    const value = exactObject(parsed, [
      "provider",
      "unique_key",
      "display_name",
      "forward_webhooks",
      "credentials",
    ]) ?? exactObject(parsed, ["provider", "unique_key", "display_name", "forward_webhooks"]);
    const id = typeof value?.unique_key === "string" ? value.unique_key : "";
    const spec = managedIntegrations[id as keyof typeof managedIntegrations];
    valid = Boolean(
      value
      && spec?.create
      && value.provider === spec.provider
      && value.display_name === spec.displayName
      && value.forward_webhooks === false
      && (spec.oauth ? validOauthCredentials(value.credentials) : !("credentials" in value)),
    );
  } else if (url.pathname.startsWith("/integrations/") && method === "PATCH") {
    const id = identifierPath(url.pathname, "/integrations/") ?? "";
    const spec = managedIntegrations[id as keyof typeof managedIntegrations];
    const value = exactObject(parsed, ["display_name", "forward_webhooks", "credentials"])
      ?? exactObject(parsed, ["display_name", "forward_webhooks"]);
    valid = Boolean(
      value
      && spec
      && value.display_name === spec.displayName
      && value.forward_webhooks === false
      && ("credentials" in value ? spec.oauth && validOauthCredentials(value.credentials) : true),
    );
  } else if (url.pathname === "/connections" && method === "POST") {
    const value = exactObject(parsed, [
      "provider_config_key",
      "connection_id",
      "credentials",
      "metadata",
    ]);
    const credentials = exactObject(value?.credentials, ["type"]);
    valid = Boolean(
      value
      && value.provider_config_key === "agent-conversations"
      && agentSyncInstanceId(value.connection_id) !== undefined
      && credentials?.type === "NONE"
      && validAgentMetadata(value.metadata, value.connection_id),
    );
  } else if (url.pathname === "/connections/metadata" && method === "POST") {
    const value = exactObject(parsed, ["provider_config_key", "connection_id", "metadata"]);
    valid = Boolean(
      value
      && value.provider_config_key === "agent-conversations"
      && agentSyncInstanceId(value.connection_id) !== undefined
      && validAgentMetadata(value.metadata, value.connection_id),
    );
  }
  if (!valid) throw new Error(`Nango controller request body denied for ${method} ${url.pathname}`);
}

const remoteRequestSource = String.raw`
const access = process.env.CONTEXT_USE_NANGO_ACCESS;
const expectedMethod = process.env.CONTEXT_USE_NANGO_REQUEST_METHOD;
const expectedPathEncoded = process.env.CONTEXT_USE_NANGO_REQUEST_PATH_B64;
const fail = () => { console.error("Internal Nango request failed"); process.exit(1); };
const chunks = [];
const identifier = (value) => {
  if (typeof value !== "string" || !/^[a-z][a-z0-9_-]{0,254}$/.test(value)) throw new Error();
  return value;
};
const agentSyncInstanceId = (value) => {
  if (typeof value !== "string") return undefined;
  const match = value.match(/^agent-sync(?:-([a-f0-9]{32}))?$/);
  return match ? (match[1] ?? null) : undefined;
};
const boundedString = (value, maximum = 512) => {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum) throw new Error();
  return value;
};
const projectIntegration = (payload) => {
  const value = payload && typeof payload === "object" ? payload.data : null;
  if (!value || typeof value !== "object" || typeof value.forward_webhooks !== "boolean") throw new Error();
  const result = {
    unique_key: identifier(value.unique_key),
    provider: identifier(value.provider),
    forward_webhooks: value.forward_webhooks,
  };
  if (value.display_name === null) result.display_name = null;
  else if (value.display_name !== undefined) result.display_name = boundedString(value.display_name, 256);
  if (value.webhook_url === null) result.webhook_url = null;
  else if (value.webhook_url !== undefined) {
    const webhook = new URL(boundedString(value.webhook_url, 2_048));
    const publicOrigin = new URL(process.env.NANGO_PUBLIC_SERVER_URL).origin;
    if (webhook.protocol !== "https:" || webhook.origin !== publicOrigin
      || webhook.username || webhook.password || webhook.search || webhook.hash) throw new Error();
    result.webhook_url = webhook.toString();
  }
  return { data: result };
};
const projectAgentMetadata = (value, connectionId) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
  const instanceId = agentSyncInstanceId(connectionId);
  if (instanceId === undefined) throw new Error();
  const expected = instanceId === null
    ? ["authenticated_webhook", "daemon_version", "deployment_id", "label", "updated_at"]
    : ["authenticated_webhook", "daemon_version", "deployment_id", "instance_id", "label", "updated_at"];
  if (Object.keys(value).sort().join("|") !== expected.sort().join("|")) throw new Error();
  if (instanceId !== null && value.instance_id !== instanceId) throw new Error();
  const webhook = value.authenticated_webhook;
  if (!webhook || typeof webhook !== "object" || Array.isArray(webhook)
    || Object.keys(webhook).sort().join("|") !== "state|token_sha256"
    || !["active", "revoked"].includes(webhook.state)
    || typeof webhook.token_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(webhook.token_sha256)) throw new Error();
  const updatedAt = boundedString(value.updated_at, 64);
  if (!Number.isFinite(Date.parse(updatedAt))) throw new Error();
  return {
    authenticated_webhook: { state: webhook.state, token_sha256: webhook.token_sha256 },
    deployment_id: boundedString(value.deployment_id, 256),
    ...(instanceId === null ? {} : { instance_id: instanceId }),
    label: boundedString(value.label, 256),
    daemon_version: boundedString(value.daemon_version, 128),
    updated_at: updatedAt,
  };
};
const exactObject = (value, keys) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
  if (Object.keys(value).sort().join("|") !== [...keys].sort().join("|")) throw new Error();
  return value;
};
const integrationSpecs = {
  github: { provider: "github", displayName: "GitHub", create: true, oauth: true },
  granola: { provider: "granola-mcp", displayName: "Granola", create: false, oauth: false },
  "agent-conversations": {
    provider: "authenticated-webhook",
    displayName: "Agent Conversations",
    create: true,
    oauth: false,
  },
};
const assertOauthCredentials = (value) => {
  const credentials = exactObject(value, ["type", "client_id", "client_secret", "scopes"]);
  if (credentials.type !== "OAUTH2" || credentials.scopes !== "repo"
    || /[\r\n\0]/.test(boundedString(credentials.client_id, 1024))
    || /[\r\n\0]/.test(boundedString(credentials.client_secret, 4096))) throw new Error();
};
const assertRequestBody = (request, url) => {
  if (request.method === "GET") {
    if (request.body !== null) throw new Error();
    return;
  }
  if (access !== "integration-manager" || request.body === null) throw new Error();
  const parsed = JSON.parse(request.body);
  if (url.pathname === "/integrations" && request.method === "POST") {
    let value;
    try { value = exactObject(parsed, ["provider", "unique_key", "display_name", "forward_webhooks", "credentials"]); }
    catch { value = exactObject(parsed, ["provider", "unique_key", "display_name", "forward_webhooks"]); }
    const spec = integrationSpecs[value.unique_key];
    if (!spec || !spec.create || value.provider !== spec.provider || value.display_name !== spec.displayName
      || value.forward_webhooks !== false || (spec.oauth ? !Object.hasOwn(value, "credentials") : Object.hasOwn(value, "credentials"))) throw new Error();
    if (spec.oauth) assertOauthCredentials(value.credentials);
    return;
  }
  if (url.pathname.startsWith("/integrations/") && request.method === "PATCH") {
    let value;
    try { value = exactObject(parsed, ["display_name", "forward_webhooks", "credentials"]); }
    catch { value = exactObject(parsed, ["display_name", "forward_webhooks"]); }
    const id = decodeURIComponent(url.pathname.slice("/integrations/".length));
    const spec = integrationSpecs[id];
    if (!spec || value.display_name !== spec.displayName || value.forward_webhooks !== false
      || (Object.hasOwn(value, "credentials") && !spec.oauth)) throw new Error();
    if (Object.hasOwn(value, "credentials")) assertOauthCredentials(value.credentials);
    return;
  }
  if (url.pathname === "/connections" && request.method === "POST") {
    const value = exactObject(parsed, ["provider_config_key", "connection_id", "credentials", "metadata"]);
    const credentials = exactObject(value.credentials, ["type"]);
    if (value.provider_config_key !== "agent-conversations" || agentSyncInstanceId(value.connection_id) === undefined
      || credentials.type !== "NONE") throw new Error();
    projectAgentMetadata(value.metadata, value.connection_id);
    return;
  }
  if (url.pathname === "/connections/metadata" && request.method === "POST") {
    const value = exactObject(parsed, ["provider_config_key", "connection_id", "metadata"]);
    if (value.provider_config_key !== "agent-conversations" || agentSyncInstanceId(value.connection_id) === undefined) throw new Error();
    projectAgentMetadata(value.metadata, value.connection_id);
    return;
  }
  throw new Error();
};
const projectConnection = (value, includeMetadata) => {
  if (!value || typeof value !== "object") throw new Error();
  const result = {
    connection_id: identifier(value.connection_id),
    provider_config_key: identifier(value.provider_config_key),
  };
  if (includeMetadata) {
    if (agentSyncInstanceId(result.connection_id) === undefined || result.provider_config_key !== "agent-conversations") throw new Error();
    result.metadata = value.metadata === null ? null : projectAgentMetadata(value.metadata, result.connection_id);
  }
  return result;
};
const projectScript = (value) => {
  if (!value || typeof value !== "object") throw new Error();
  const result = { name: identifier(value.name) };
  if (value.type !== undefined) result.type = boundedString(value.type, 32);
  for (const field of ["runs", "version", "last_deployed"]) {
    if (value[field] === null) result[field] = null;
    else if (value[field] !== undefined) result[field] = boundedString(value[field], 256);
  }
  return result;
};
const projectSuccess = (payload, request) => {
  const url = new URL("http://nango.internal" + request.path);
  if (url.pathname === "/api/v1/user") return {};
  if (url.pathname === "/integrations" || url.pathname.startsWith("/integrations/")) {
    return projectIntegration(payload);
  }
  if ((url.pathname.startsWith("/connections/") && url.pathname !== "/connections/metadata")
    || url.pathname === "/connections/metadata"
    || (url.pathname === "/connections" && request.method === "POST")) {
    return projectConnection(payload, true);
  }
  if (url.pathname === "/connections" && request.method === "GET") {
    if (!payload || typeof payload !== "object" || !Array.isArray(payload.connections)
      || payload.connections.length > ${NANGO_CONNECTION_PAGE_SIZE}) throw new Error();
    return { connections: payload.connections.map((value) => projectConnection(value, false)) };
  }
  if (url.pathname === "/scripts/config") {
    if (!Array.isArray(payload)) throw new Error();
    const expectedSync = { github: "pull-requests", granola: "meetings", "agent-conversations": "conversations" };
    const configs = payload.filter((value) => value && typeof value === "object" && expectedSync[value.providerConfigKey]);
    if (configs.length > 3 || new Set(configs.map((value) => value.providerConfigKey)).size !== configs.length) throw new Error();
    return configs.map((value) => {
      if (!Array.isArray(value.syncs)) throw new Error();
      const syncs = value.syncs.filter((sync) => sync && sync.name === expectedSync[value.providerConfigKey]);
      if (syncs.length > 1) throw new Error();
      return {
        providerConfigKey: identifier(value.providerConfigKey),
        syncs: syncs.map(projectScript),
        actions: [],
        "on-events": [],
      };
    });
  }
  throw new Error();
};
process.stdin.on("data", (chunk) => chunks.push(chunk));
process.stdin.on("end", async () => {
  try {
    const request = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (typeof expectedPathEncoded !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(expectedPathEncoded)
      || !["GET", "POST", "PATCH"].includes(expectedMethod)) fail();
    const expectedPath = Buffer.from(expectedPathEncoded, "base64").toString("utf8");
    if (!request || typeof request.path !== "string" || !request.path.startsWith("/")
      || request.path.startsWith("//") || /[\\\r\n\0]/.test(request.path)
      || !["GET", "POST", "PATCH"].includes(request.method)
      || request.method !== expectedMethod || request.path !== expectedPath
      || (request.body !== null && typeof request.body !== "string")) fail();
    const requestUrl = new URL("http://nango.internal" + request.path);
    assertRequestBody(request, requestUrl);
    const headers = { Accept: "application/json" };
    if (request.body !== null) headers["Content-Type"] = "application/json";
    if (access === "dashboard") {
      const username = process.env.NANGO_DASHBOARD_USERNAME;
      const password = process.env.NANGO_DASHBOARD_PASSWORD;
      if (!username || !password) fail();
      headers.Authorization = "Basic " + Buffer.from(username + ":" + password).toString("base64");
    } else if (access === "integration-manager") {
      const apiKey = process.env.NANGO_INTERNAL_API_KEY;
      if (!apiKey) fail();
      headers.Authorization = "Bearer " + apiKey;
    } else if (access !== "anonymous") fail();
    const response = await fetch("http://127.0.0.1:3003" + request.path, {
      method: request.method,
      headers,
      body: request.body === null ? undefined : request.body,
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    const rawBody = await response.text();
    let body = "";
    if (!response.ok) {
      body = "";
    } else {
      body = JSON.stringify(projectSuccess(JSON.parse(rawBody), request));
    }
    if (Buffer.byteLength(body, "utf8") > ${maximumResponseBytes}) fail();
    const envelope = {
      status: response.status,
      statusText: response.statusText,
      contentType: "application/json",
      body,
    };
    process.stdout.write("${responseMarker}" + Buffer.from(JSON.stringify(envelope)).toString("base64") + "\n");
  } catch { fail(); }
});
`;

export function internalNangoRequestCommands(input: {
  access: InternalNangoAccess;
  requestParameter: string;
  method: string;
  path: string;
  apiKeyParameter?: string;
}): string[] {
  if (!requestParameterPattern.test(input.requestParameter)) throw new Error("Invalid internal Nango request parameter");
  const method = input.method.toUpperCase();
  let pathUrl: URL;
  try {
    pathUrl = new URL(input.path, "https://nango.internal");
  } catch {
    throw new Error("Invalid internal Nango request route");
  }
  if (`${pathUrl.pathname}${pathUrl.search}` !== input.path || pathUrl.origin !== "https://nango.internal" || pathUrl.hash) {
    throw new Error("Invalid internal Nango request route");
  }
  assertInternalNangoRoute(input.access, method, pathUrl);
  if (input.access === "integration-manager") {
    if (!input.apiKeyParameter || !apiKeyParameterPattern.test(input.apiKeyParameter)) {
      throw new Error("Invalid Nango integration-manager parameter");
    }
  } else if (input.apiKeyParameter) {
    throw new Error("An API key parameter is only valid for integration-manager access");
  }
  const encodedSource = Buffer.from(remoteRequestSource).toString("base64");
  const encodedPath = Buffer.from(input.path).toString("base64");
  const compose = "docker compose --env-file /data/context-use/secrets/runtime.env";
  const environment = input.access === "integration-manager"
    ? [
        `export NANGO_INTERNAL_API_KEY="$(aws ssm get-parameter --name '${input.apiKeyParameter}' --with-decryption --query Parameter.Value --output text)"`,
        "test -n \"$NANGO_INTERNAL_API_KEY\"",
        "trap 'unset NANGO_INTERNAL_API_KEY' EXIT",
      ]
    : [];
  return [
    ...environment,
    "cd /opt/context-use/deploy",
    `aws ssm get-parameter --name '${input.requestParameter}' --with-decryption --query Parameter.Value --output text`
      + ` | ${compose} exec -T`
      + (input.access === "integration-manager" ? " -e NANGO_INTERNAL_API_KEY" : "")
      + ` -e CONTEXT_USE_NANGO_REQUEST_METHOD='${method}'`
      + ` -e CONTEXT_USE_NANGO_REQUEST_PATH_B64='${encodedPath}'`
      + ` -e CONTEXT_USE_NANGO_ACCESS='${input.access}' nango-server`
      + ` node -e \"eval(Buffer.from('${encodedSource}','base64').toString('utf8'))\"`,
    ...(input.access === "integration-manager" ? ["unset NANGO_INTERNAL_API_KEY", "trap - EXIT"] : []),
  ];
}

function parseRemoteResponse(output: string): Response {
  const encoded = output
    .split(/\r?\n/)
    .findLast((line) => line.startsWith(responseMarker))
    ?.slice(responseMarker.length);
  if (!encoded) throw new Error("Internal Nango request returned no response");
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  } catch {
    throw new Error("Internal Nango request returned an invalid response");
  }
  const response = responseSchema.parse(parsed);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    ...(response.contentType ? { headers: { "Content-Type": response.contentType } } : {}),
  });
}

export async function cleanupStaleNangoRequestParameters(
  profile: string,
  region: string,
  prefix: string,
  dependencies: Pick<InternalNangoDependencies, "deleteRequest" | "listRequests" | "now"> = {},
): Promise<string[]> {
  if (!requestPrefixPattern.test(prefix)) throw new Error("Invalid internal Nango request prefix");
  const listRequests = dependencies.listRequests ?? (async (requestProfile, requestRegion, requestPrefix) => {
    const parameters: Array<{ Name?: string; LastModifiedDate?: string | number }> = [];
    let nextToken: string | undefined;
    do {
      const result = await awsJson<{
        Parameters?: Array<{ Name?: string; LastModifiedDate?: string | number }>;
        NextToken?: string;
      }>(requestProfile, requestRegion, [
        "ssm",
        "describe-parameters",
        "--parameter-filters",
        `Key=Path,Option=OneLevel,Values=${requestPrefix}`,
        "--max-results",
        "50",
        ...(nextToken ? ["--next-token", nextToken] : []),
      ]);
      parameters.push(...(result.Parameters ?? []));
      nextToken = result.NextToken;
    } while (nextToken);
    return parameters;
  });
  const deleteRequest = dependencies.deleteRequest ?? deleteSecureParameter;
  const now = dependencies.now?.() ?? Date.now();
  const deleted: string[] = [];
  for (const parameter of await listRequests(profile, region, prefix)) {
    if (!parameter.Name || !requestParameterPattern.test(parameter.Name)
      || !parameter.Name.startsWith(`${prefix}/`) || parameter.LastModifiedDate === undefined) continue;
    const rawModified = typeof parameter.LastModifiedDate === "number"
      ? parameter.LastModifiedDate
      : Date.parse(parameter.LastModifiedDate);
    const modified = typeof parameter.LastModifiedDate === "number" && rawModified < 1_000_000_000_000
      ? rawModified * 1_000
      : rawModified;
    if (!Number.isFinite(modified) || now - modified <= 60 * 60 * 1_000) continue;
    await deleteRequest(profile, region, parameter.Name);
    deleted.push(parameter.Name);
  }
  return deleted;
}

export function createInternalNangoFetcher(
  config: DeploymentConfig,
  data: DataOutputs,
  instanceId: string,
  access: InternalNangoAccess,
  dependencies: InternalNangoDependencies = {},
): typeof fetch {
  if (!/^i-[a-f0-9]+$/.test(instanceId)) throw new Error("Invalid Context Use instance ID");
  const expectedOrigin = `https://${config.nangoHostname}`;
  const prefix = `/context-use/${config.installationId}/${config.environment}`;
  const putRequest = dependencies.putRequest ?? putSecureParameter;
  const deleteRequest = dependencies.deleteRequest ?? deleteSecureParameter;
  const sendCommands = dependencies.sendCommands ?? sendSsmCommands;
  const requestId = dependencies.requestId ?? (() => randomBytes(16).toString("hex"));
  let cleanupPromise: Promise<string[]> | null = null;

  return (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const signal = init?.signal ?? undefined;
    if (signal?.aborted) throw new DOMException("Operation was aborted", "AbortError");
    if (input instanceof Request) throw new Error("Internal Nango requests do not accept Request objects");
    const url = new URL(input.toString());
    if (url.origin !== expectedOrigin || url.username || url.password || url.hash) {
      throw new Error("Internal Nango requests must target the configured Nango origin");
    }
    const method = (init?.method ?? "GET").toUpperCase();
    assertInternalNangoRoute(access, method, url);
    const headers = new Headers(init?.headers);
    for (const name of headers.keys()) {
      if (name !== "accept" && name !== "content-type") {
        throw new Error(`Internal Nango request header ${name} is not allowed`);
      }
    }
    const body = init?.body === undefined || init.body === null ? null : String(init.body);
    if (headers.has("accept") && headers.get("accept") !== "application/json") {
      throw new Error("Internal Nango requests accept only application/json");
    }
    if ((body === null && headers.has("content-type"))
      || (body !== null && headers.has("content-type") && headers.get("content-type") !== "application/json")) {
      throw new Error("Internal Nango request content type must be application/json");
    }
    assertInternalNangoRequestBody(access, method, url, body);
    const envelope = JSON.stringify({ method, path: `${url.pathname}${url.search}`, body });
    if (Buffer.byteLength(envelope, "utf8") > maximumParameterValueBytes) {
      throw new Error("Internal Nango request exceeds the SSM Standard 4 KiB limit");
    }
    const id = requestId();
    if (!/^[a-f0-9]{32}$/.test(id)) throw new Error("Invalid internal Nango request ID");
    const requestParameter = `${prefix}/internal-requests/nango-${id}`;
    try {
      cleanupPromise ??= cleanupStaleNangoRequestParameters(
        config.awsProfile,
        config.awsRegion,
        `${prefix}/internal-requests`,
        dependencies,
      );
      await cleanupPromise;
      if (signal?.aborted) throw new DOMException("Operation was aborted", "AbortError");
      await putRequest(
        config.awsProfile,
        config.awsRegion,
        requestParameter,
        envelope,
        data.kms_key_arn,
      );
      if (signal?.aborted) throw new DOMException("Operation was aborted", "AbortError");
      const output = await sendCommands(
        config.awsProfile,
        config.awsRegion,
        instanceId,
        internalNangoRequestCommands({
          access,
          requestParameter,
          method,
          path: `${url.pathname}${url.search}`,
          ...(access === "integration-manager"
            ? { apiKeyParameter: `${prefix}/NANGO_INTEGRATION_MANAGER_API_KEY` }
            : {}),
        }),
        signal ? { signal } : {},
      );
      return parseRemoteResponse(output);
    } finally {
      await deleteRequest(config.awsProfile, config.awsRegion, requestParameter);
    }
  }) as typeof fetch;
}

export async function probeInternalNangoReady(
  config: DeploymentConfig,
  instanceId: string,
  dependencies: InternalNangoDependencies = {},
): Promise<boolean> {
  if (!/^i-[a-f0-9]+$/.test(instanceId)) throw new Error("Invalid Context Use instance ID");
  const sendCommands = dependencies.sendCommands ?? sendSsmCommands;
  const source = "fetch('http://127.0.0.1:3003/ready',{redirect:'error',signal:AbortSignal.timeout(5000)})"
    + ".then(async r=>{const b=await r.json();if(!r.ok||b?.result!=='ok')process.exit(1);console.log('CONTEXT_USE_NANGO_READY')})"
    + ".catch(()=>process.exit(1))";
  const output = await sendCommands(config.awsProfile, config.awsRegion, instanceId, [
    "cd /opt/context-use/deploy",
    "docker compose --env-file /data/context-use/secrets/runtime.env exec -T nango-server"
      + ` node -e \"${source}\"`,
  ]);
  return output.split(/\r?\n/).includes("CONTEXT_USE_NANGO_READY");
}

const boundaryMarker = "CONTEXT_USE_NANGO_BOUNDARY_OK";

export function externalNangoBoundaryCommands(
  config: DeploymentConfig,
  options: { requireManagedApiKey?: boolean } = {},
): string[] {
  if (!/^(?=.{1,240}$)(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(config.nangoHostname)) {
    throw new Error("Invalid Nango boundary hostname");
  }
  const prefix = `/context-use/${config.installationId}/${config.environment}`;
  if (!/^\/context-use\/[a-z0-9-]+\/[a-z0-9-]+$/.test(prefix)) throw new Error("Invalid Nango boundary parameter prefix");
  const origin = `https://${config.nangoHostname}`;
  const curl = `curl --noproxy '*' --proto '=https' --tlsv1.2 --silent --show-error --max-time 10 --resolve '${config.nangoHostname}:443:127.0.0.1'`;
  const blocked = [
    "/ready",
    "/api/v1/environment/api-keys?env=prod",
    "/records",
    "/connections",
    "/scripts/config",
  ];
  return [
    `nango_origin='${origin}'`,
    `nango_root_result="$(${curl} --output /dev/null --write-out '%{http_code} %{redirect_url}' \"$nango_origin/\" 2>/dev/null)"`,
    `nango_expected_redirect='302 ${origin}/_context-use-auth/start?rd=${origin}/'`,
    "if [ \"$nango_root_result\" != \"$nango_expected_redirect\" ]; then echo 'Nango external boundary check failed' >&2; exit 1; fi",
    ...blocked.flatMap((path, index) => [
      `nango_status_${index}="$(${curl} --output /dev/null --write-out '%{http_code}' \"$nango_origin${path}\" 2>/dev/null)"`,
      `case "$nango_status_${index}" in 2??) echo 'Nango external boundary check failed' >&2; exit 1;; esac`,
    ]),
    `nango_dashboard_username="$(aws ssm get-parameter --name '${prefix}/NANGO_DASHBOARD_USERNAME' --with-decryption --query Parameter.Value --output text)"`,
    `nango_dashboard_password="$(aws ssm get-parameter --name '${prefix}/NANGO_DASHBOARD_PASSWORD' --with-decryption --query Parameter.Value --output text)"`,
    "nango_dashboard_basic=\"$(printf '%s' \"$nango_dashboard_username:$nango_dashboard_password\" | base64 -w0)\"",
    `nango_basic_status="$(printf 'header = \"Authorization: Basic %s\"\\n' \"$nango_dashboard_basic\" | ${curl} --config /dev/stdin --output /dev/null --write-out '%{http_code}' \"$nango_origin/api/v1/user\" 2>/dev/null)"`,
    "case \"$nango_basic_status\" in 2??) echo 'Nango external boundary check failed' >&2; exit 1;; esac",
    ...(options.requireManagedApiKey === false ? [] : [
    `nango_manager_key="$(aws ssm get-parameter --name '${prefix}/NANGO_INTEGRATION_MANAGER_API_KEY' --with-decryption --query Parameter.Value --output text)"`,
    "case \"$nango_manager_key\" in ''|*[!A-Za-z0-9_-]*) echo 'Nango external boundary check failed' >&2; exit 1;; esac",
    `nango_bearer_status="$(printf 'header = \"Authorization: Bearer %s\"\\n' \"$nango_manager_key\" | ${curl} --config /dev/stdin --output /dev/null --write-out '%{http_code}' \"$nango_origin/connections?integrationId=github&limit=${NANGO_CONNECTION_PAGE_SIZE}&page=0\" 2>/dev/null)"`,
    "case \"$nango_bearer_status\" in 2??) echo 'Nango external boundary check failed' >&2; exit 1;; esac",
    ]),
    "unset nango_dashboard_username nango_dashboard_password nango_dashboard_basic nango_manager_key",
    `echo '${boundaryMarker}'`,
  ];
}

export async function verifyExternalNangoBoundary(
  config: DeploymentConfig,
  instanceId: string,
  dependencies: Pick<InternalNangoDependencies, "sendCommands"> = {},
  options: { requireManagedApiKey?: boolean } = {},
): Promise<boolean> {
  if (!/^i-[a-f0-9]+$/.test(instanceId)) throw new Error("Invalid Context Use instance ID");
  const output = await (dependencies.sendCommands ?? sendSsmCommands)(
    config.awsProfile,
    config.awsRegion,
    instanceId,
    externalNangoBoundaryCommands(config, options),
  );
  if (output.trim() !== boundaryMarker) throw new Error("Nango external boundary returned an invalid response");
  return true;
}
