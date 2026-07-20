import { resolve4 } from "node:dns/promises";
import { resolve } from "node:path";
import {
  generateSecret,
  getSecureParameter,
  putSecureParameter,
  sendSsmCommands,
  waitForSsm,
} from "./aws.ts";
import { markDataVolumeInitialized } from "./data-volume.ts";
import { currentVersion, deploymentRoot } from "./release.ts";
import type { DeploymentConfig, ReleaseManifest } from "./types.ts";

export async function deploy(config: DeploymentConfig, manifest: ReleaseManifest): Promise<void> {
  if (!config.computeOutputs) throw new Error("Compute infrastructure outputs are missing");
  const expectPublicMcp = manifest.version === currentVersion;
  if (expectPublicMcp) await assertPublicMcpDns(config);
  await ensureRuntimeParameterUpgrades(config);
  await prepareCompute(config);
  const deployScript = await Bun.file(resolve(await deploymentRoot(manifest), "deploy/deploy.sh")).text();
  const command = deploymentCommands(config, manifest, deployScript);
  await sendSsmCommands(config.awsProfile, config.awsRegion, config.computeOutputs.instance_id, command);
  await verifyDeployment(config, manifest.version, expectPublicMcp);
  await verifyRemoteSecurity(config);
}

export function computeBootstrapCommands(): string[] {
  return [
    "if cloud-init status --wait; then exit 0; fi",
    "cloud-init status --long || true",
    "tail -n 100 /var/log/cloud-init-output.log >&2 || true",
    "exit 1",
  ];
}

export async function prepareCompute(config: DeploymentConfig): Promise<void> {
  if (!config.computeOutputs) throw new Error("Compute infrastructure outputs are missing");
  await waitForSsm(config.awsProfile, config.awsRegion, config.computeOutputs.instance_id);
  await sendSsmCommands(
    config.awsProfile,
    config.awsRegion,
    config.computeOutputs.instance_id,
    computeBootstrapCommands(),
  );
  await markDataVolumeInitialized(config);
}

async function ensureRuntimeParameterUpgrades(config: DeploymentConfig): Promise<void> {
  if (!config.dataOutputs) throw new Error("Data infrastructure outputs are missing");
  const prefix = `/context-use/${config.installationId}/${config.environment}`;
  for (const [parameter, length] of [
    ["DB_PUBLIC_MCP_PASSWORD", 36],
    ["DB_CONFIRMATION_PASSWORD", 36],
    ["DB_STORAGE_PASSWORD", 36],
    ["MCP_ASSET_CAPABILITY_SECRET", 48],
    ["CONFIRMATION_GATEWAY_TOKEN", 48],
    ["AUTH_DASHBOARD_TOKEN", 48],
    ["AUTH_MCP_TOKEN", 48],
    ["CONFIRMATION_DASHBOARD_TOKEN", 48],
    ["STORAGE_DASHBOARD_TOKEN", 48],
    ["STORAGE_MCP_TOKEN", 48],
    ["STORAGE_PUBLIC_TOKEN", 48],
  ] as const) {
    const name = `${prefix}/${parameter}`;
    try {
      await getSecureParameter(config.awsProfile, config.awsRegion, name);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("ParameterNotFound")) throw error;
      await putSecureParameter(
        config.awsProfile,
        config.awsRegion,
        name,
        generateSecret(length),
        config.dataOutputs.kms_key_arn,
      );
    }
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
  const rolePrefix = `context-use-${config.installationId}-${config.environment}`;
  const storageRoleArn = `arn:aws:iam::${config.accountId}:role/${rolePrefix}-storage`;
  const backupRoleArn = `arn:aws:iam::${config.accountId}:role/${rolePrefix}-backup`;
  return [
    "trap 'rm -f /tmp/context-use-deploy.sh' EXIT",
    `echo '${encoded}' | base64 -d > /tmp/context-use-deploy.sh`,
    "chmod 0700 /tmp/context-use-deploy.sh",
    `CONTEXT_USE_VERSION='${manifest.version}' CONTEXT_USE_ENVIRONMENT='${config.environment}' CONTEXT_USE_BUNDLE_URL='${manifest.deployment_bundle.url}' CONTEXT_USE_BUNDLE_SHA256='${manifest.deployment_bundle.sha256}' CONTEXT_USE_APP_IMAGE='${manifest.images.app}' CONTEXT_USE_BACKUP_IMAGE='${manifest.images.backup}' CONTEXT_USE_PARAMETER_PREFIX='/context-use/${config.installationId}/${config.environment}' CONTEXT_USE_STORAGE_ROLE_ARN='${storageRoleArn}' CONTEXT_USE_BACKUP_ROLE_ARN='${backupRoleArn}' /tmp/context-use-deploy.sh`,
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
    "AND NOT has_column_privilege('context_use_dashboard','knowledge_pages','public_path','UPDATE')",
    "AND NOT has_column_privilege('context_use_dashboard','knowledge_pages','required_public_path','UPDATE')",
    "AND NOT has_function_privilege('context_use_mcp','confirm_publication_intent(uuid,text,text,text,integer,integer)','EXECUTE')",
    "AND NOT has_function_privilege('context_use_dashboard','issue_confirmation_challenge(confirmation_intent_kind,uuid,text)','EXECUTE')",
    "AND has_function_privilege('context_use_confirmation','issue_confirmation_challenge(confirmation_intent_kind,uuid,text)','EXECUTE')",
    "AND has_function_privilege('context_use_confirmation','confirm_publication_intent(uuid,text,text,text,integer,integer)','EXECUTE')",
    "AND has_function_privilege('context_use_confirmation','confirm_knowledge_export_intent(uuid,text,text,text,integer,integer)','EXECUTE')",
    "AND NOT has_table_privilege('context_use_confirmation','publication_intents','SELECT')",
    "AND NOT has_table_privilege('context_use_confirmation','knowledge_pages','SELECT')",
    "AND NOT has_table_privilege('context_use_confirmation','confirmation_challenges','SELECT')",
    "AND NOT has_column_privilege('context_use_dashboard','publication_intents','challenge','INSERT')",
    "AND NOT has_column_privilege('context_use_dashboard','publication_intents','challenge','UPDATE')",
    "AND has_column_privilege('context_use_confirmation','passkey','publicKey','SELECT')",
    "AND has_column_privilege('context_use_confirmation','passkey','counter','SELECT')",
    "AND has_column_privilege('context_use_auth','passkey','counter','UPDATE')",
    "AND NOT has_column_privilege('context_use_auth','passkey','publicKey','UPDATE')",
    "AND NOT has_table_privilege('context_use_auth','passkey','DELETE')",
    "AND NOT has_column_privilege('context_use_auth','user','email','UPDATE')",
    "AND NOT has_table_privilege('context_use_auth','user','DELETE')",
    "AND NOT has_database_privilege('context_use_public_mcp',current_database(),'TEMPORARY')",
    "AND NOT has_schema_privilege('context_use_public_mcp','public','CREATE')",
    "AND NOT pg_has_role('context_use_public_mcp','context_use_projection_owner','MEMBER')",
    "AND NOT pg_has_role('context_use_public_mcp','context_use_boundary_owner','MEMBER')",
    "AND (SELECT NOT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolinherit AND NOT rolbypassrls FROM pg_roles WHERE rolname='context_use_projection_owner')",
    "AND (SELECT NOT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolinherit AND NOT rolbypassrls FROM pg_roles WHERE rolname='context_use_boundary_owner')",
    "AND (SELECT pg_get_userbyid(relowner)='context_use_projection_owner' FROM pg_class WHERE oid='published_pages'::regclass)",
    "AND (SELECT pg_get_userbyid(relowner)='context_use_projection_owner' FROM pg_class WHERE oid='published_assets'::regclass)",
    "AND (SELECT pg_get_userbyid(relowner)='context_use_projection_owner' FROM pg_class WHERE oid='published_page_sources'::regclass)",
    "AND (SELECT pg_get_userbyid(relowner)='context_use_projection_owner' FROM pg_class WHERE oid='storage_published_assets'::regclass)",
    "AND (SELECT pg_get_userbyid(relowner)='context_use_projection_owner' FROM pg_class WHERE oid='public_mcp_pages'::regclass)",
    "AND (SELECT pg_get_userbyid(proowner)='context_use_projection_owner' AND prosecdef AND pronargs=1 FROM pg_proc WHERE oid='project_public_markdown(text)'::regprocedure)",
    "AND (SELECT pg_get_userbyid(proowner)='context_use_projection_owner' AND prosecdef AND pronargs=1 FROM pg_proc WHERE oid='project_public_mcp_markdown(text)'::regprocedure)",
    "AND (SELECT pg_get_userbyid(proowner)='context_use_boundary_owner' AND prosecdef FROM pg_proc WHERE oid='issue_confirmation_challenge(confirmation_intent_kind,uuid,text)'::regprocedure)",
    "AND (SELECT pg_get_userbyid(proowner)='context_use_boundary_owner' AND prosecdef FROM pg_proc WHERE oid='confirm_publication_intent(uuid,text,text,text,integer,integer)'::regprocedure)",
    "AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='user_protect_owner_identity' AND NOT tgisinternal)",
    "AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='passkey_protect_credential' AND NOT tgisinternal)",
    "AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname='knowledge_pages_published_active' AND convalidated)",
    "AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname='assets_published_active' AND convalidated)",
    "AND NOT has_table_privilege('context_use_public','knowledge_pages','SELECT')",
    "AND has_table_privilege('context_use_public','published_pages','SELECT')",
    "AND has_function_privilege('context_use_public','project_public_markdown(text)','EXECUTE')",
    "AND NOT has_function_privilege('context_use_public','project_public_mcp_markdown(text)','EXECUTE')",
    "AND NOT has_table_privilege('context_use_public','published_page_sources','SELECT')",
    "AND NOT has_table_privilege('context_use_public','storage_published_assets','SELECT')",
    "AND (SELECT array_agg(column_name::text ORDER BY ordinal_position)=ARRAY['public_path','title','body_markdown'] FROM information_schema.columns WHERE table_schema='public' AND table_name='published_pages')",
    "AND (SELECT array_agg(column_name::text ORDER BY ordinal_position)=ARRAY['public_path','filename','content_type','size_bytes'] FROM information_schema.columns WHERE table_schema='public' AND table_name='published_assets')",
    "AND has_column_privilege('context_use_storage','assets','s3_object_key','SELECT')",
    "AND has_column_privilege('context_use_storage','assets','content_hash','SELECT')",
    "AND NOT has_table_privilege('context_use_storage','knowledge_pages','SELECT')",
    "AND has_table_privilege('context_use_storage','storage_published_assets','SELECT')",
    "AND NOT has_table_privilege('context_use_storage','published_assets','SELECT')",
    "AND NOT has_table_privilege('context_use_public_mcp','published_pages','SELECT')",
    "AND NOT has_table_privilege('context_use_public_mcp','knowledge_pages','SELECT')",
    "AND has_table_privilege('context_use_public_mcp','public_mcp_pages','SELECT')",
    "AND NOT has_function_privilege('context_use_public_mcp','project_public_markdown(text)','EXECUTE')",
    "AND has_function_privilege('context_use_public_mcp','project_public_mcp_markdown(text)','EXECUTE')",
    "AND NOT has_function_privilege('context_use_auth','project_public_markdown(text)','EXECUTE')",
    "AND NOT has_function_privilege('context_use_auth','project_public_mcp_markdown(text)','EXECUTE')",
    "AND NOT has_function_privilege('context_use_dashboard','project_public_markdown(text)','EXECUTE')",
    "AND NOT has_function_privilege('context_use_dashboard','project_public_mcp_markdown(text)','EXECUTE')",
    "AND NOT has_function_privilege('context_use_mcp','project_public_markdown(text)','EXECUTE')",
    "AND NOT has_function_privilege('context_use_mcp','project_public_mcp_markdown(text)','EXECUTE')",
    "AND NOT has_function_privilege('context_use_storage','project_public_markdown(text)','EXECUTE')",
    "AND NOT has_function_privilege('context_use_storage','project_public_mcp_markdown(text)','EXECUTE')",
    "AND NOT has_table_privilege('context_use_public_mcp','inbound_messages','SELECT')",
    "AND has_column_privilege('context_use_public_mcp','inbound_messages','id','INSERT')",
    "AND has_column_privilege('context_use_public_mcp','inbound_messages','reply_to','INSERT')",
    "AND has_column_privilege('context_use_public_mcp','inbound_messages','message','INSERT')",
    "AND NOT has_column_privilege('context_use_public_mcp','inbound_messages','owner_user_id','INSERT')",
    "AND has_table_privilege('context_use_dashboard','inbound_messages','SELECT')",
    "AND NOT has_table_privilege('context_use_dashboard','inbound_messages','INSERT')",
    "AND NOT has_table_privilege('context_use_dashboard','knowledge_asset_links','DELETE')",
    "AND NOT has_table_privilege('context_use_mcp','knowledge_asset_links','DELETE')",
    "AND has_column_privilege('context_use_mcp','agent_skills','name','INSERT')",
    "AND has_column_privilege('context_use_mcp','agent_skill_versions','instructions_markdown','INSERT')",
    "AND has_column_privilege('context_use_mcp','agent_skill_versions','description','INSERT')",
    "AND has_column_privilege('context_use_mcp','automation_versions','instructions_markdown','INSERT')",
    "AND NOT has_column_privilege('context_use_mcp','automation_versions','instructions_markdown','UPDATE')",
    "AND has_column_privilege('context_use_mcp','cron_schedules','cron_expression','INSERT')",
    "AND has_column_privilege('context_use_mcp','cron_schedules','current_version_id','INSERT')",
    "AND NOT has_column_privilege('context_use_mcp','cron_schedules','cron_expression','UPDATE')",
    "AND has_column_privilege('context_use_mcp','automation_runs','status','UPDATE')",
    "AND NOT has_column_privilege('context_use_dashboard','automation_runs','status','UPDATE')",
    "AND has_column_privilege('context_use_mcp','knowledge_pages','automation_id','INSERT')",
    "AND NOT has_column_privilege('context_use_mcp','knowledge_pages','automation_id','UPDATE')",
    "AND EXISTS (SELECT 1 FROM knowledge_pages WHERE required_public_path='about' AND current_path='about/intro' AND public_path='about' AND published_version_id IS NOT NULL AND archived_at IS NULL)",
    "AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='knowledge_pages_automation_path' AND NOT tgisinternal)",
    "AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='knowledge_page_versions_automation_path' AND NOT tgisinternal)",
    "AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='publication_intents_keep_automation_pages_private' AND NOT tgisinternal)",
    "AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='publication_intents_protect_required_public_page' AND NOT tgisinternal)",
    "THEN 'ok' ELSE 'denied' END",
  ].join(" ");
  const encodedSql = Buffer.from(sql).toString("base64");
  return [
    "cd /opt/context-use/deploy",
    `set -a; . ${envFile}; set +a`,
    "export PGPASSWORD=\"$POSTGRES_PASSWORD\"",
    `test "$(printf %s ${encodedSql} | base64 -d | ${compose} exec -T -e PGPASSWORD postgres psql -U postgres -d context_use -Atq)" = ok`,
    `${compose} exec -T --user 1000:1000 -e AWS_CONFIG_FILE=/etc/context-use/aws-storage-config -e AWS_PROFILE=context-use-storage -e AWS_EC2_METADATA_DISABLED=true aws-credential-broker aws s3api get-bucket-encryption --bucket "$ASSET_BUCKET" --query "ServerSideEncryptionConfiguration.Rules[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm" --output text | grep -qx aws:kms`,
    `${compose} exec -T --user 1000:1000 -e AWS_CONFIG_FILE=/etc/context-use/aws-storage-config -e AWS_PROFILE=context-use-storage -e AWS_EC2_METADATA_DISABLED=true aws-credential-broker aws s3api get-public-access-block --bucket "$ASSET_BUCKET" --query "PublicAccessBlockConfiguration.[BlockPublicAcls,IgnorePublicAcls,BlockPublicPolicy,RestrictPublicBuckets]" --output text | tr -d "[:space:]" | grep -qx TrueTrueTrueTrue`,
    `${compose} exec -T backup aws s3api head-bucket --bucket "$BACKUP_BUCKET"`,
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
  const landing = await fetch(origin);
  const landingHtml = await landing.text();
  if (!landing.ok
      || !landingHtml.includes('href="/p/about"')
      || !landingHtml.includes(`${publicOrigin}/mcp`)
      || !landingHtml.includes("send_message")) {
    throw new Error("The public billboard is unavailable or incomplete");
  }
  const about = await fetch(`${origin}/p/about`);
  if (!about.ok) throw new Error("The required public About page is unavailable");
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
