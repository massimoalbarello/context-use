import { z } from "zod";
import { getSecureParameter, getSecureParameterIfPresent, putSecureParameter } from "./aws.ts";
import type { DataOutputs, DeploymentConfig } from "./types.ts";

const nangoApiKeySchema = z.object({
  id: z.number().int().positive(),
  display_name: z.string(),
  scopes: z.array(z.string()),
  secret: z.string().min(1),
});

const listApiKeysSchema = z.object({ data: z.array(nangoApiKeySchema) });
const createApiKeySchema = z.object({ data: nangoApiKeySchema });

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
      "environment:integrations:list_functions",
    ],
  },
] as const;

type NangoApiKey = z.infer<typeof nangoApiKeySchema>;
type ReadParameter = typeof getSecureParameter;
type ReadParameterIfPresent = typeof getSecureParameterIfPresent;
type WriteParameter = typeof putSecureParameter;

export type NangoApiKeyDependencies = {
  fetcher?: typeof fetch;
  readParameter?: ReadParameter;
  readParameterIfPresent?: ReadParameterIfPresent;
  writeParameter?: WriteParameter;
};

export type NangoDashboardAuthDependencies = {
  fetcher?: typeof fetch;
  readParameter?: ReadParameter;
};

async function nangoDashboardAuthorization(
  config: DeploymentConfig,
  readParameter: ReadParameter,
): Promise<string> {
  const prefix = `/context-use/${config.installationId}/${config.environment}`;
  const [username, password] = await Promise.all([
    readParameter(config.awsProfile, config.awsRegion, `${prefix}/NANGO_DASHBOARD_USERNAME`),
    readParameter(config.awsProfile, config.awsRegion, `${prefix}/NANGO_DASHBOARD_PASSWORD`),
  ]);
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

export async function verifyNangoDashboardAuthentication(
  config: DeploymentConfig,
  dependencies: NangoDashboardAuthDependencies = {},
): Promise<boolean> {
  const fetcher = dependencies.fetcher ?? fetch;
  const readParameter = dependencies.readParameter ?? getSecureParameter;
  const endpoint = `https://${config.nangoHostname}/api/v1/user`;
  const anonymous = await fetcher(endpoint, { redirect: "error", signal: AbortSignal.timeout(5_000) });
  if (anonymous.status !== 401) {
    throw new Error(`unauthenticated request returned HTTP ${anonymous.status}, expected 401`);
  }
  const authorized = await fetcher(endpoint, {
    headers: { Authorization: await nangoDashboardAuthorization(config, readParameter) },
    redirect: "error",
    signal: AbortSignal.timeout(5_000),
  });
  if (!authorized.ok) throw new Error(`Basic authentication returned HTTP ${authorized.status}`);
  return true;
}

function sameScopes(left: readonly string[], right: readonly string[]): boolean {
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.length === sortedRight.length
    && sortedLeft.every((scope, index) => scope === sortedRight[index]);
}

async function nangoRequest(
  fetcher: typeof fetch,
  url: string,
  authorization: string,
  init: RequestInit = {},
): Promise<unknown> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  headers.set("Authorization", authorization);
  if (init.body) headers.set("Content-Type", "application/json");
  const response = await fetcher(url, {
    ...init,
    headers,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`Nango API key bootstrap failed: ${init.method ?? "GET"} ${new URL(url).pathname} returned HTTP ${response.status}`);
  }
  return response.json();
}

function usableSecret(key: NangoApiKey, parameterName: string): string {
  if (key.secret.startsWith("****")) {
    throw new Error(
      `Nango API key ${key.display_name} exists, but Nango returned only a masked secret and ${parameterName} is missing from SSM. `
      + "Restore that SSM parameter from a secure backup or deliberately replace the key in Nango, then rerun the command.",
    );
  }
  return key.secret;
}

export async function ensureNangoApiKeys(
  config: DeploymentConfig,
  data: DataOutputs,
  dependencies: NangoApiKeyDependencies = {},
): Promise<void> {
  const fetcher = dependencies.fetcher ?? fetch;
  const readParameter = dependencies.readParameter ?? getSecureParameter;
  const readParameterIfPresent = dependencies.readParameterIfPresent ?? getSecureParameterIfPresent;
  const writeParameter = dependencies.writeParameter ?? putSecureParameter;
  const prefix = `/context-use/${config.installationId}/${config.environment}`;
  const authorization = await nangoDashboardAuthorization(config, readParameter);
  const endpoint = `https://${config.nangoHostname}/api/v1/environment/api-keys?env=prod`;
  const listed = listApiKeysSchema.parse(await nangoRequest(fetcher, endpoint, authorization));

  for (const managed of managedApiKeys) {
    let key = listed.data.find((candidate) => candidate.display_name === managed.displayName);
    if (!key) {
      const created = createApiKeySchema.parse(await nangoRequest(fetcher, endpoint, authorization, {
        method: "POST",
        body: JSON.stringify({ display_name: managed.displayName, scopes: managed.scopes }),
      }));
      key = created.data;
      listed.data.push(key);
    } else if (!sameScopes(key.scopes, managed.scopes)) {
      await nangoRequest(
        fetcher,
        `https://${config.nangoHostname}/api/v1/environment/api-keys/${key.id}?env=prod`,
        authorization,
        { method: "PATCH", body: JSON.stringify({ scopes: managed.scopes }) },
      );
    }

    const parameter = `${prefix}/${managed.parameterName}`;
    const storedSecret = await readParameterIfPresent(config.awsProfile, config.awsRegion, parameter);
    if (!storedSecret) {
      await writeParameter(
        config.awsProfile,
        config.awsRegion,
        parameter,
        usableSecret(key, managed.parameterName),
        data.kms_key_arn,
      );
    } else if (!key.secret.startsWith("****") && storedSecret !== key.secret) {
      await writeParameter(config.awsProfile, config.awsRegion, parameter, key.secret, data.kms_key_arn);
    }
  }
}
