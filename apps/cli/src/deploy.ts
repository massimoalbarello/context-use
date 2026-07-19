import { resolve4 } from "node:dns/promises";
import { resolve } from "node:path";
import {
  generateSecret,
  getSecureParameter,
  putSecureParameter,
  sendSsmCommands,
  waitForSsm,
} from "./aws.ts";
import { currentVersion, deploymentRoot } from "./release.ts";
import type { DeploymentConfig, ReleaseManifest } from "./types.ts";

export async function deploy(config: DeploymentConfig, manifest: ReleaseManifest): Promise<void> {
  if (!config.computeOutputs) throw new Error("Compute infrastructure outputs are missing");
  const expectPublicMcp = manifest.version === currentVersion;
  if (expectPublicMcp) await assertPublicMcpDns(config);
  await ensureRuntimeParameterUpgrades(config);
  await waitForSsm(config.awsProfile, config.awsRegion, config.computeOutputs.instance_id);
  const deployScript = await Bun.file(resolve(await deploymentRoot(manifest), "deploy/deploy.sh")).text();
  const command = deploymentCommands(config, manifest, deployScript);
  await sendSsmCommands(config.awsProfile, config.awsRegion, config.computeOutputs.instance_id, command);
  await verifyDeployment(config, manifest.version, expectPublicMcp);
  await verifyRemoteSecurity(config);
}

async function ensureRuntimeParameterUpgrades(config: DeploymentConfig): Promise<void> {
  if (!config.dataOutputs) throw new Error("Data infrastructure outputs are missing");
  const prefix = `/context-use/${config.installationId}/${config.environment}`;
  const name = `${prefix}/DB_PUBLIC_MCP_PASSWORD`;
  try {
    await getSecureParameter(config.awsProfile, config.awsRegion, name);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("ParameterNotFound")) throw error;
    await putSecureParameter(
      config.awsProfile,
      config.awsRegion,
      name,
      generateSecret(36),
      config.dataOutputs.kms_key_arn,
    );
  }
  const hostnameName = `${prefix}/PUBLIC_MCP_HOSTNAME`;
  let currentHostname: string | null = null;
  try {
    currentHostname = await getSecureParameter(config.awsProfile, config.awsRegion, hostnameName);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("ParameterNotFound")) throw error;
  }
  if (currentHostname !== config.publicMcpHostname) {
    await putSecureParameter(
      config.awsProfile,
      config.awsRegion,
      hostnameName,
      config.publicMcpHostname,
      config.dataOutputs.kms_key_arn,
    );
  }
}

export async function publicMcpDnsMatches(
  config: DeploymentConfig,
  resolver: (hostname: string) => Promise<string[]> = resolve4,
): Promise<boolean> {
  if (config.dnsMode !== "manual") return true;
  if (!config.computeOutputs) return false;
  try {
    return (await resolver(config.publicMcpHostname)).includes(config.computeOutputs.public_ip);
  } catch {
    return false;
  }
}

async function assertPublicMcpDns(config: DeploymentConfig): Promise<void> {
  if (await publicMcpDnsMatches(config)) return;
  throw new Error(
    `Create an A record for ${config.publicMcpHostname} pointing to ${config.computeOutputs?.public_ip ?? "the deployment IP"}, wait for DNS propagation, then rerun the command`,
  );
}

export function deploymentCommands(config: DeploymentConfig, manifest: ReleaseManifest, deployScript: string): string[] {
  const encoded = Buffer.from(deployScript).toString("base64");
  return [
    "trap 'rm -f /tmp/context-use-deploy.sh' EXIT",
    "cloud-init status --wait",
    `echo '${encoded}' | base64 -d > /tmp/context-use-deploy.sh`,
    "chmod 0700 /tmp/context-use-deploy.sh",
    `CONTEXT_USE_VERSION='${manifest.version}' CONTEXT_USE_ENVIRONMENT='${config.environment}' CONTEXT_USE_BUNDLE_URL='${manifest.deployment_bundle.url}' CONTEXT_USE_BUNDLE_SHA256='${manifest.deployment_bundle.sha256}' CONTEXT_USE_APP_IMAGE='${manifest.images.app}' CONTEXT_USE_BACKUP_IMAGE='${manifest.images.backup}' CONTEXT_USE_PARAMETER_PREFIX='/context-use/${config.installationId}/${config.environment}' /tmp/context-use-deploy.sh`,
  ];
}

export async function verifyRemoteSecurity(config: DeploymentConfig): Promise<void> {
  if (!config.computeOutputs) throw new Error("Compute infrastructure outputs are missing");
  await sendSsmCommands(config.awsProfile, config.awsRegion, config.computeOutputs.instance_id, remoteSecurityCommands());
}

export function remoteSecurityCommands(): string[] {
  const envFile = "/data/context-use/secrets/runtime.env";
  const compose = `docker compose --env-file ${envFile}`;
  const sql = [
    "SELECT CASE WHEN",
    "NOT has_column_privilege('context_use_mcp','knowledge_pages','published_version_id','UPDATE')",
    "AND NOT has_column_privilege('context_use_dashboard','knowledge_pages','public_slug','UPDATE')",
    "AND NOT has_function_privilege('context_use_mcp','confirm_publication_intent(uuid,text,text,text)','EXECUTE')",
    "AND has_function_privilege('context_use_publisher','confirm_publication_intent(uuid,text,text,text)','EXECUTE')",
    "AND NOT has_table_privilege('context_use_public','knowledge_pages','SELECT')",
    "AND has_table_privilege('context_use_public','published_pages','SELECT')",
    "AND NOT has_table_privilege('context_use_public_mcp','published_pages','SELECT')",
    "AND NOT has_table_privilege('context_use_public_mcp','knowledge_pages','SELECT')",
    "AND has_table_privilege('context_use_public_mcp','public_mcp_pages','SELECT')",
    "AND NOT has_table_privilege('context_use_public_mcp','inbound_messages','SELECT')",
    "AND has_column_privilege('context_use_public_mcp','inbound_messages','id','INSERT')",
    "AND has_column_privilege('context_use_public_mcp','inbound_messages','reply_to','INSERT')",
    "AND has_column_privilege('context_use_public_mcp','inbound_messages','message','INSERT')",
    "AND NOT has_column_privilege('context_use_public_mcp','inbound_messages','owner_user_id','INSERT')",
    "AND has_table_privilege('context_use_dashboard','inbound_messages','SELECT')",
    "AND NOT has_table_privilege('context_use_dashboard','inbound_messages','INSERT')",
    "AND NOT has_schema_privilege('context_use_public_mcp','public','CREATE')",
    "AND has_column_privilege('context_use_mcp','automation_skills','name','INSERT')",
    "AND has_column_privilege('context_use_mcp','automation_skill_versions','instructions_markdown','INSERT')",
    "AND has_column_privilege('context_use_mcp','automation_skill_versions','description','INSERT')",
    "AND has_column_privilege('context_use_mcp','cron_schedules','cron_expression','INSERT')",
    "AND NOT has_column_privilege('context_use_mcp','cron_schedules','cron_expression','UPDATE')",
    "AND has_column_privilege('context_use_mcp','automation_runs','status','UPDATE')",
    "AND NOT has_column_privilege('context_use_dashboard','automation_runs','status','UPDATE')",
    "AND has_column_privilege('context_use_mcp','knowledge_pages','automation_id','INSERT')",
    "AND NOT has_column_privilege('context_use_mcp','knowledge_pages','automation_id','UPDATE')",
    "AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='knowledge_pages_automation_path' AND NOT tgisinternal)",
    "AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='knowledge_page_versions_automation_path' AND NOT tgisinternal)",
    "AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='publication_intents_keep_automation_pages_private' AND NOT tgisinternal)",
    "THEN 'ok' ELSE 'denied' END",
  ].join(" ");
  const encodedSql = Buffer.from(sql).toString("base64");
  return [
    "cd /opt/context-use/deploy",
    `set -a; . ${envFile}; set +a`,
    "export PGPASSWORD=\"$POSTGRES_PASSWORD\"",
    `test "$(printf %s ${encodedSql} | base64 -d | ${compose} exec -T -e PGPASSWORD postgres psql -U postgres -d context_use -Atq)" = ok`,
    "test \"$(aws s3api get-bucket-encryption --bucket \"$ASSET_BUCKET\" --query \"ServerSideEncryptionConfiguration.Rules[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm\" --output text)\" = aws:kms",
    "test \"$(aws s3api get-public-access-block --bucket \"$ASSET_BUCKET\" --query \"PublicAccessBlockConfiguration.[BlockPublicAcls,IgnorePublicAcls,BlockPublicPolicy,RestrictPublicBuckets]\" --output text | tr -d \"[:space:]\")\" = TrueTrueTrueTrue",
    "aws s3api head-bucket --bucket \"$BACKUP_BUCKET\"",
    `${compose} run --rm backup once`,
  ];
}

export function healthMatchesVersion(health: unknown, releaseVersion: string): boolean {
  if (!health || typeof health !== "object" || !("version" in health)) return false;
  return health.version === releaseVersion.replace(/^v/, "");
}

async function verifyDeployment(config: DeploymentConfig, releaseVersion: string, expectPublicMcp: boolean): Promise<void> {
  const origin = `https://${config.hostname}`;
  let lastError = "health check did not complete";
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const health = await fetch(`${origin}/api/health`, { redirect: "error" });
      if (health.ok) {
        const body: unknown = await health.json();
        if (healthMatchesVersion(body, releaseVersion)) break;
        lastError = `health returned a version other than ${releaseVersion}`;
      } else {
        lastError = `health returned HTTP ${health.status}`;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (attempt === 59) throw new Error(`Deployment did not become healthy: ${lastError}`);
    await Bun.sleep(3_000);
  }
  const metadata = await fetch(`${origin}/.well-known/oauth-protected-resource/mcp`);
  if (!metadata.ok) throw new Error("MCP protected-resource metadata is unavailable");
  const bearerDashboard = await fetch(`${origin}/api/dashboard/pages`, { headers: { Authorization: "Bearer invalid" } });
  if (bearerDashboard.status !== 401) throw new Error("Security check failed: dashboard did not reject bearer authentication");
  const cookieMcp = await fetch(`${origin}/mcp`, { method: "POST", headers: { Cookie: "better-auth.session_token=invalid", "Content-Type": "application/json" }, body: "{}" });
  if (cookieMcp.status !== 401) throw new Error("Security check failed: MCP did not reject browser cookies");
  if (!expectPublicMcp) return;
  const publicOrigin = `https://${config.publicMcpHostname}`;
  for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
    const discovery = await fetch(`${publicOrigin}${path}`, { redirect: "error" });
    if (discovery.status !== 404 || discovery.headers.has("www-authenticate")) {
      throw new Error("Security check failed: public MCP hostname advertised authentication");
    }
  }
  const publicMcp = await fetch(`${publicOrigin}/mcp`, {
    method: "POST",
    headers: { Accept: "application/json, text/event-stream", "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "context-use-deployer", version: releaseVersion.replace(/^v/, "") },
      },
    }),
  });
  if (!publicMcp.ok) throw new Error("Public MCP endpoint is unavailable");
  const publicWithCookie = await fetch(`${publicOrigin}/mcp`, {
    method: "POST",
    headers: { Cookie: "better-auth.session_token=invalid", "Content-Type": "application/json" },
    body: "{}",
  });
  if (publicWithCookie.status !== 400) throw new Error("Security check failed: public MCP accepted browser cookies");
  const legacyPublicMcp = await fetch(`${origin}/public/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (legacyPublicMcp.status !== 404 || legacyPublicMcp.headers.has("www-authenticate")) {
    throw new Error("Security check failed: legacy public MCP route remains reachable");
  }
}
