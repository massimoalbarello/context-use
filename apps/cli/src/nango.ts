import { sendSsmCommands } from "./aws.ts";
import {
  createInternalNangoFetcher,
  type InternalNangoDependencies,
  verifyExternalNangoBoundary,
} from "./nango-internal.ts";
import type { DataOutputs, DeploymentConfig } from "./types.ts";

const managedApiKeys = [
  {
    displayName: "context-use-deployer",
    parameterName: "NANGO_DEPLOYER_API_KEY",
    scopes: ["environment:deploy"],
  },
  {
    displayName: "context-use-pipeline",
    parameterName: "NANGO_PIPELINE_API_KEY",
    scopes: [
      "environment:records:read",
      "environment:connections:list",
    ],
  },
  {
    displayName: "context-use-integration-manager",
    parameterName: "NANGO_INTEGRATION_MANAGER_API_KEY",
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
  },
] as const;

type SendCommands = typeof sendSsmCommands;

export type NangoApiKeyDependencies = {
  sendCommands?: SendCommands;
};

export type NangoDashboardAuthDependencies = {
  anonymousFetcher?: typeof fetch;
  authorizedFetcher?: typeof fetch;
  internal?: InternalNangoDependencies;
};

const keyReconciliationMarker = "CONTEXT_USE_NANGO_KEYS_OK";
const prefixPattern = /^\/context-use\/[a-z0-9-]+\/[a-z0-9-]+$/;
const kmsKeyPattern = /^arn:aws(?:-[a-z]+)?:kms:[a-z0-9-]+:[0-9]{12}:key\/[A-Za-z0-9-]{1,128}$/;

const apiKeyWorkerSource = String.raw`
const targets = ${JSON.stringify(Object.fromEntries(managedApiKeys.map((key) => [
  key.displayName,
  { display_name: key.displayName, scopes: key.scopes },
])))};
const probes = {
  "context-use-deployer": {
    path: "/functions/deployments/00000000-0000-0000-0000-000000000000",
    statuses: [404],
  },
  "context-use-pipeline": { path: "/connections?limit=1&page=0", statuses: [200] },
  "context-use-integration-manager": { path: "/scripts/config", statuses: [200] },
};
const target = targets[process.env.CONTEXT_USE_MANAGED_KEY];
const probe = probes[process.env.CONTEXT_USE_MANAGED_KEY];
const mode = process.env.CONTEXT_USE_KEY_MODE;
const stop = () => process.exit(1);
if (!target || !probe || !["write", "verify"].includes(mode)) stop();
const dashboardRequest = async (path, init = {}) => {
  const username = process.env.NANGO_DASHBOARD_USERNAME;
  const password = process.env.NANGO_DASHBOARD_PASSWORD;
  if (!username || !password) stop();
  const response = await fetch("http://127.0.0.1:3003" + path, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: "Basic " + Buffer.from(username + ":" + password).toString("base64"),
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) stop();
  return response;
};
const sameScopes = (left, right) => Array.isArray(left)
  && left.length === right.length
  && [...left].sort().every((scope, index) => scope === [...right].sort()[index]);
void (async () => { try {
  if (mode === "verify") {
    const chunks = [];
    let length = 0;
    for await (const chunk of process.stdin) {
      const bytes = Buffer.from(chunk);
      length += bytes.length;
      if (length > 4096) stop();
      chunks.push(bytes);
    }
    let secret = Buffer.concat(chunks).toString("utf8");
    if (secret.endsWith("\n")) secret = secret.slice(0, -1);
    if (secret.endsWith("\r")) secret = secret.slice(0, -1);
    if (!secret || /[\r\n\0]/.test(secret)) stop();
    const response = await fetch("http://127.0.0.1:3003" + probe.path, {
      headers: { Accept: "application/json", Authorization: "Bearer " + secret },
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    if (!probe.statuses.includes(response.status)) stop();
    process.exit(0);
  }
  const listed = await dashboardRequest("/api/v1/environment/api-keys?env=prod").then((response) => response.json());
  if (!listed || !Array.isArray(listed.data)) stop();
  const matches = listed.data.filter((key) => key && key.display_name === target.display_name);
  if (matches.length > 1) stop();
  let key = matches[0];
  if (!key) {
    const created = await dashboardRequest("/api/v1/environment/api-keys?env=prod", {
      method: "POST",
      body: JSON.stringify(target),
    }).then((response) => response.json());
    key = created && created.data;
  }
  if (!key || !Number.isInteger(key.id) || key.id < 1
    || key.display_name !== target.display_name || !Array.isArray(key.scopes)) stop();
  if (!sameScopes(key.scopes, target.scopes)) {
    await dashboardRequest("/api/v1/environment/api-keys/" + key.id + "?env=prod", {
      method: "PATCH",
      body: JSON.stringify({ scopes: target.scopes }),
    });
  }
  if (typeof key.secret !== "string" || key.secret.length < 1 || key.secret.startsWith("****")
    || /[\r\n\0]/.test(key.secret)) stop();
  process.stdout.write(key.secret);
} catch { stop(); } })();
`;

export function nangoApiKeyReconciliationCommands(config: DeploymentConfig, data: DataOutputs): string[] {
  const prefix = `/context-use/${config.installationId}/${config.environment}`;
  if (!prefixPattern.test(prefix)) throw new Error("Invalid Nango parameter prefix");
  if (!kmsKeyPattern.test(data.kms_key_arn)) throw new Error("Invalid Nango parameter KMS key");
  const encodedWorker = Buffer.from(apiKeyWorkerSource).toString("base64");
  const compose = "docker compose --env-file /data/context-use/secrets/runtime.env";
  const commands = [
    "cd /opt/context-use/deploy",
    `nango_key_worker='${encodedWorker}'`,
  ];
  for (const key of managedApiKeys) {
    const parameter = `${prefix}/${key.parameterName}`;
    const worker = `${compose} exec -T -e CONTEXT_USE_MANAGED_KEY='${key.displayName}'`;
    commands.push(
      `if ! ${worker} -e CONTEXT_USE_KEY_MODE=write nango-server node -e \"eval(Buffer.from('$nango_key_worker','base64').toString('utf8'))\" 2>/dev/null | aws ssm put-parameter --name '${parameter}' --type SecureString --key-id '${data.kms_key_arn}' --overwrite --value file:///dev/stdin >/dev/null 2>&1; then echo 'Nango API key reconciliation failed' >&2; exit 1; fi`,
      `if ! aws ssm get-parameter --name '${parameter}' --with-decryption --query Parameter.Value --output text 2>/dev/null | ${worker} -e CONTEXT_USE_KEY_MODE=verify nango-server node -e \"eval(Buffer.from('$nango_key_worker','base64').toString('utf8'))\" >/dev/null 2>&1; then echo 'Nango API key verification failed' >&2; exit 1; fi`,
    );
  }
  commands.push("unset nango_key_worker", `echo '${keyReconciliationMarker}'`);
  return commands;
}

export async function verifyNangoDashboardAuthentication(
  config: DeploymentConfig,
  data: DataOutputs,
  instanceId: string,
  dependencies: NangoDashboardAuthDependencies = {},
): Promise<boolean> {
  const anonymousFetcher = dependencies.anonymousFetcher
    ?? createInternalNangoFetcher(config, data, instanceId, "anonymous", dependencies.internal);
  const authorizedFetcher = dependencies.authorizedFetcher
    ?? createInternalNangoFetcher(config, data, instanceId, "dashboard", dependencies.internal);
  const endpoint = `https://${config.nangoHostname}/api/v1/user`;
  const anonymous = await anonymousFetcher(endpoint, { redirect: "error", signal: AbortSignal.timeout(5_000) });
  if (anonymous.status !== 401) {
    throw new Error(`unauthenticated request returned HTTP ${anonymous.status}, expected 401`);
  }
  const authorized = await authorizedFetcher(endpoint, {
    redirect: "error",
    signal: AbortSignal.timeout(5_000),
  });
  if (!authorized.ok) throw new Error(`Internal Basic authentication returned HTTP ${authorized.status}`);
  return true;
}

export async function ensureNangoApiKeys(
  config: DeploymentConfig,
  data: DataOutputs,
  instanceId: string,
  dependencies: NangoApiKeyDependencies = {},
): Promise<void> {
  if (!/^i-[a-f0-9]+$/.test(instanceId)) throw new Error("Invalid Context Use instance ID");
  const output = await (dependencies.sendCommands ?? sendSsmCommands)(
    config.awsProfile,
    config.awsRegion,
    instanceId,
    nangoApiKeyReconciliationCommands(config, data),
  );
  if (output.trim() !== keyReconciliationMarker) {
    throw new Error("Nango API key reconciliation returned an invalid response");
  }
  // This credential would return a valid connection-list response if any
  // public route accidentally reached Nango, so test the real edge after the
  // on-instance key has been reconciled and persisted.
  await verifyExternalNangoBoundary(
    config,
    instanceId,
    dependencies.sendCommands ? { sendCommands: dependencies.sendCommands } : {},
  );
}
