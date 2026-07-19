import { expect, test } from "bun:test";
import { strictSsmCommands, waitForSsmInvocation } from "./aws.ts";
import { deploymentCommands, healthMatchesVersion, publicMcpDnsMatches, remoteSecurityCommands } from "./deploy.ts";
import { restoreCommands } from "./commands/restore.ts";
import { normalizeDeploymentConfig } from "./paths.ts";
import { redactSensitiveText } from "./process.ts";
import { canReplaceDeploymentConfig, shouldPauseForManualDns } from "./setup.ts";
import { backendArgs, terraformEnvironment } from "./terraform.ts";
import type { DeploymentConfig, ReleaseManifest } from "./types.ts";

function deploymentConfig(overrides: Partial<DeploymentConfig> = {}): DeploymentConfig {
  return {
    schemaVersion: 1,
    releaseVersion: "v0.1.2",
    phase: "new",
    environment: "production",
    installationId: "abcdef123456",
    awsProfile: "default",
    awsRegion: "eu-west-2",
    availabilityZone: "eu-west-2a",
    accountId: "123456789012",
    hostname: "context.example.com",
    assetHostname: "assets.context.example.com",
    publicMcpHostname: "public.context.example.com",
    dnsMode: "manual",
    route53ZoneId: "",
    ownerEmail: "owner@example.com",
    parametersReady: false,
    stateBucket: "context-use-state",
    stateKmsKeyArn: "arn:aws:kms:eu-west-2:123456789012:key/state",
    instanceType: "t3.small",
    dataVolumeSizeGb: 50,
    backupRetentionDays: 30,
    ...overrides,
  };
}

const manifest: ReleaseManifest = {
  version: "v0.1.2",
  terraform: { minimum: "1.11.0", maximum_exclusive: "2.0.0" },
  deployment_bundle: { url: "https://github.com/example/release.tar.gz", sha256: "a".repeat(64) },
  images: {
    app: `ghcr.io/example/app@sha256:${"b".repeat(64)}`,
    backup: `ghcr.io/example/backup@sha256:${"c".repeat(64)}`,
  },
};

test("Terraform receives exported short-lived credentials without a backend profile", async () => {
  const config = deploymentConfig();
  let command: string[] = [];
  const env = await terraformEnvironment(config, async (observed) => {
    command = observed;
    return JSON.stringify({ AccessKeyId: "temporary-key", SecretAccessKey: "temporary-secret", SessionToken: "temporary-token" });
  });

  expect(command).toEqual([
    "aws", "--profile", "default", "--region", "eu-west-2",
    "configure", "export-credentials", "--format", "process",
  ]);
  expect(env).toMatchObject({
    AWS_ACCESS_KEY_ID: "temporary-key",
    AWS_SECRET_ACCESS_KEY: "temporary-secret",
    AWS_SESSION_TOKEN: "temporary-token",
    AWS_EC2_METADATA_DISABLED: "true",
  });
  expect(backendArgs(config, "installation/production/data.tfstate").some((argument) => argument.includes("profile="))).toBe(false);
});

test("diagnostics retain credential-source errors while removing actual secret values", () => {
  const diagnostic = [
    "No valid credential sources found",
    "AWS_SECRET_ACCESS_KEY=do-not-print",
    "\"SessionToken\": \"also-secret\"",
    "postgres://owner:database-password@example.com/context_use",
  ].join("\n");
  const redacted = redactSensitiveText(diagnostic);

  expect(redacted).toContain("No valid credential sources found");
  expect(redacted).not.toContain("do-not-print");
  expect(redacted).not.toContain("also-secret");
  expect(redacted).not.toContain("database-password");
  expect(redacted.match(/\[redacted\]/g)?.length).toBe(3);
});

test("SSM scripts fail on the first unsuccessful command", () => {
  expect(strictSsmCommands(["false", "echo cleanup"])).toEqual(["set -euo pipefail", "false", "echo cleanup"]);
  expect(strictSsmCommands(["set -euo pipefail", "echo ok"])).toEqual(["set -euo pipefail", "echo ok"]);
});

test("SSM polling treats in-progress commands and invocation propagation as non-terminal", async () => {
  const responses = [
    new Error("InvocationDoesNotExist"),
    { Status: "Pending" },
    { Status: "InProgress" },
    { Status: "Success", StandardOutputContent: "deployed" },
  ];
  let pauses = 0;
  const invocation = await waitForSsmInvocation(async () => {
    const response = responses.shift();
    if (response instanceof Error) throw response;
    if (!response) throw new Error("No response");
    return response;
  }, async () => { pauses += 1; }, 4);

  expect(invocation).toEqual({ Status: "Success", StandardOutputContent: "deployed" });
  expect(pauses).toBe(3);
});

test("SSM polling returns terminal failures and bounds the wait", async () => {
  expect(await waitForSsmInvocation(async () => ({ Status: "Failed" }), async () => {}, 1)).toEqual({ Status: "Failed" });
  await expect(waitForSsmInvocation(async () => ({ Status: "InProgress" }), async () => {}, 2))
    .rejects.toThrow("within one hour");
});

test("deployment waits for cloud-init and always removes its temporary script", () => {
  const commands = strictSsmCommands(deploymentCommands(deploymentConfig(), manifest, "#!/bin/sh\nexit 0\n"));

  expect(commands.slice(0, 4)).toEqual([
    "set -euo pipefail",
    "trap 'rm -f /tmp/context-use-deploy.sh' EXIT",
    "cloud-init status --wait",
    expect.stringContaining("base64 -d"),
  ]);
  expect(commands.at(-1)).toContain("arn:aws:iam::123456789012:role/context-use-abcdef123456-production-storage");
  expect(commands.at(-1)).toContain("arn:aws:iam::123456789012:role/context-use-abcdef123456-production-backup");
});

test("remote verification avoids shell-quoting SQL and passes the database password through the environment", () => {
  const commands = remoteSecurityCommands();
  const script = commands.join("\n");
  const encodedSql = script.match(/printf %s ([A-Za-z0-9+/=]+) \| base64 -d/)?.[1];
  const sql = Buffer.from(encodedSql ?? "", "base64").toString();

  expect(script).toContain("base64 -d");
  expect(script).toContain("export PGPASSWORD=\"$POSTGRES_PASSWORD\"");
  expect(script).toContain("exec -T -e PGPASSWORD postgres psql");
  expect(script).toContain("AWS_PROFILE=context-use-storage");
  expect(script).toContain("AWS_EC2_METADATA_DISABLED=true");
  expect(script).not.toContain("confirm_publication_intent");
  expect(script).not.toContain("sh -c");
  expect(sql).toContain("tgname='knowledge_pages_automation_path'");
  expect(sql).toContain("'agent_skills'");
  expect(sql).toContain("'automation_versions'");
  expect(sql).toContain("required_public_path='about'");
  expect(sql).toContain("current_path='about/intro'");
  expect(sql).toContain("tgname='publication_intents_protect_required_public_page'");
  expect(sql).toContain("context_use_projection_owner");
  expect(sql).toContain("context_use_boundary_owner");
  expect(sql).toContain("context_use_confirmation");
  expect(sql).toContain("context_use_storage");
  expect(sql).toContain("issue_confirmation_challenge");
  expect(sql).toContain("passkey_protect_credential");
  expect(sql).toContain("user_protect_owner_identity");
  expect(sql).toContain("current_database(),'TEMPORARY'");
  expect(sql).toContain("knowledge_asset_links','DELETE'");
  expect(sql).not.toContain("conname='knowledge_pages_automation_path_boundary'");
});

test("restore sources the database password and restarts services after errors", () => {
  const script = restoreCommands("backup-bucket", "postgres/2026-07-17T10-39-47Z.sql.gz").join("\n");

  expect(script).toContain(". /data/context-use/secrets/runtime.env");
  expect(script).toContain("export PGPASSWORD=\"$POSTGRES_PASSWORD\"");
  expect(script).toContain("exec -T -e PGPASSWORD postgres psql");
  expect(script).toContain("backup fetch 'postgres/2026-07-17T10-39-47Z.sql.gz'");
  expect(script).not.toContain("aws s3 cp");
  expect(script).toContain("trap 'docker compose");
  expect(script).not.toContain("POSTGRES_PASSWORD=");
});

test("deployment health must report the requested release version", () => {
  expect(healthMatchesVersion({ status: "ok", version: "0.1.4" }, "v0.1.4")).toBe(true);
  expect(healthMatchesVersion({ status: "ok", version: "0.1.3" }, "v0.1.4")).toBe(false);
  expect(healthMatchesVersion({ status: "ok" }, "v0.1.4")).toBe(false);
});

test("legacy configs derive a dedicated public MCP hostname", () => {
  const { publicMcpHostname: _publicMcpHostname, ...legacy } = deploymentConfig();
  expect(normalizeDeploymentConfig(legacy)).toMatchObject({
    hostname: "context.example.com",
    publicMcpHostname: "public.context.example.com",
  });
});

test("manual public MCP DNS must resolve to the deployment IP", async () => {
  const config = deploymentConfig({ computeOutputs: {
    instance_id: "i-test",
    public_ip: "192.0.2.10",
    app_url: "https://context.example.com",
    asset_url: "https://assets.context.example.com",
    public_mcp_url: "https://public.context.example.com/mcp",
    cloudwatch_log_group: "test",
  } });
  expect(await publicMcpDnsMatches(config, async () => ["192.0.2.10"])).toBe(true);
  expect(await publicMcpDnsMatches(config, async () => ["192.0.2.11"])).toBe(false);
  expect(await publicMcpDnsMatches(config, async () => { throw new Error("NXDOMAIN"); })).toBe(false);
  expect(await publicMcpDnsMatches({ ...config, dnsMode: "route53" }, async () => [])).toBe(true);
});

test("an interrupted manual-DNS setup pauses once before deployment", () => {
  expect(shouldPauseForManualDns(deploymentConfig({ phase: "new" }))).toBe(true);
  expect(shouldPauseForManualDns(deploymentConfig({ phase: "compute_ready" }))).toBe(true);
  expect(shouldPauseForManualDns(deploymentConfig({ phase: "awaiting_dns" }))).toBe(false);
  expect(shouldPauseForManualDns(deploymentConfig({ phase: "deployed" }))).toBe(false);
  expect(shouldPauseForManualDns(deploymentConfig({ phase: "compute_ready", dnsMode: "route53" }))).toBe(false);
});

test("setup can replace only a fully purged deployment record", () => {
  expect(canReplaceDeploymentConfig(deploymentConfig({ phase: "purged" }))).toBe(true);
  expect(canReplaceDeploymentConfig(deploymentConfig({ phase: "destroyed" }))).toBe(false);
  expect(canReplaceDeploymentConfig(deploymentConfig({ phase: "deployed" }))).toBe(false);
});

test("instance bootstrap, proxy limits, and TLS configuration contain the live-deployment fixes", async () => {
  const [userData, deployScript, caddy, compute, update, data, deployCompose] = await Promise.all([
    Bun.file(new URL("../../../infra/compute/user-data.sh.tftpl", import.meta.url)).text(),
    Bun.file(new URL("../../../deploy/deploy.sh", import.meta.url)).text(),
    Bun.file(new URL("../../../deploy/Caddyfile", import.meta.url)).text(),
    Bun.file(new URL("../../../infra/compute/main.tf", import.meta.url)).text(),
    Bun.file(new URL("./commands/update.ts", import.meta.url)).text(),
    Bun.file(new URL("../../../infra/data/main.tf", import.meta.url)).text(),
    Bun.file(new URL("../../../deploy/docker-compose.yml", import.meta.url)).text(),
  ]);

  expect(userData.indexOf("install -d -m 0755 /usr/local/lib/docker/cli-plugins")).toBeLessThan(userData.indexOf("docker-compose-linux-"));
  expect(userData).toContain("Refusing to format non-blank retained data volume");
  expect(userData).toContain("cmp -n 16777216");
  expect(userData).not.toContain("if ! blkid");
  expect(deployScript).toContain("mountpoint -q /data");
  expect(deployScript).toContain("/data/context-use/.volume-id");
  expect(deployScript.indexOf("up -d --remove-orphans")).toBeLessThan(deployScript.indexOf("up -d --force-recreate --no-deps caddy"));
  expect(caddy).not.toContain("email off");
  expect(caddy).toContain("handle /api/dashboard/assets/*/content");
  expect(caddy).toContain("handle /api/mcp/assets/*/content");
  expect(caddy).toContain("handle /content.css");
  expect(caddy).toContain("handle /api/dashboard/publications/confirm");
  const confirmationRoutes = caddy.slice(
    caddy.indexOf("handle /api/dashboard/publications/confirm"),
    caddy.indexOf("handle /api/dashboard/session"),
  );
  expect(confirmationRoutes).toContain("reverse_proxy auth:3002");
  expect(confirmationRoutes).not.toContain("confirmation:3004");
  expect(caddy).toContain("handle /api/auth/*");
  expect(caddy).toContain("reverse_proxy auth:3002");
  expect(caddy).not.toContain("handle /api/public/assets/*/content");
  expect(caddy).not.toContain("handle /public/mcp");
  expect(caddy).toContain("{$PUBLIC_MCP_HOSTNAME}");
  expect(caddy).toContain("handle /mcp");
  expect(caddy).toContain("reverse_proxy public-mcp:3001");
  const publicMcpSite = caddy.slice(
    caddy.indexOf("{$PUBLIC_MCP_HOSTNAME}"),
    caddy.indexOf("{$ASSET_HOSTNAME}"),
  );
  expect(publicMcpSite).toContain('respond "Not found" 404');
  expect(publicMcpSite).not.toContain("reverse_proxy app:3000");
  expect(publicMcpSite).not.toContain("oauth-protected-resource");
  const assetSite = caddy.slice(caddy.indexOf("{$ASSET_HOSTNAME}"));
  expect(assetSite).toContain("handle /p/*");
  expect(assetSite).toContain('respond "Not found" 404');
  expect(assetSite).not.toContain("/api/dashboard");
  expect(assetSite).not.toContain("/api/mcp");
  const publicMcpService = deployCompose.slice(
    deployCompose.indexOf("\n  public-mcp:\n"),
    deployCompose.indexOf("\n  caddy:\n"),
  );
  const lockedService = deployCompose.slice(
    deployCompose.indexOf("x-locked-service:"),
    deployCompose.indexOf("x-logging:"),
  );
  expect(lockedService).toContain("read_only: true");
  expect(lockedService).toContain("cap_drop: [ALL]");
  expect(publicMcpService).toContain("networks: [public_mcp_data, public_mcp]");
  expect(publicMcpService).not.toContain("networks: [data");
  expect(publicMcpService).not.toContain("web");
  expect(publicMcpService).not.toContain("outbound");
  expect(publicMcpService).toContain("PUBLIC_MCP_DATABASE_URL");
  expect(publicMcpService).toContain("PUBLIC_MCP_ENDPOINT: https://${PUBLIC_MCP_HOSTNAME}/mcp");
  expect(publicMcpService).not.toContain("DATABASE_URL: postgres://context_use_dashboard");
  expect(publicMcpService).not.toContain("OWNER_EMAIL");
  expect(publicMcpService).not.toContain("AWS_REGION:");
  const appService = deployCompose.slice(
    deployCompose.indexOf("\n  app:\n"),
    deployCompose.indexOf("\n  auth:\n"),
  );
  expect(appService).toContain("PUBLIC_MCP_ENDPOINT: https://${PUBLIC_MCP_HOSTNAME}/mcp");
  expect(appService).toContain("DATABASE_URL: postgres://context_use_dashboard");
  expect(appService).not.toContain("AUTH_DATABASE_URL");
  expect(appService).not.toContain("MCP_DATABASE_URL");
  expect(appService).not.toContain("CONFIRMATION_DATABASE_URL");
  expect(appService).not.toContain("BETTER_AUTH_SECRET");
  expect(appService).not.toContain("AWS_REGION:");
  expect(appService).toContain("STORAGE_DASHBOARD_TOKEN");
  expect(appService).toContain("AUTH_DASHBOARD_TOKEN");
  expect(appService).toContain("CONFIRMATION_DASHBOARD_TOKEN");
  expect(appService).not.toContain("AUTH_MCP_TOKEN");
  expect(appService).not.toContain("CONFIRMATION_GATEWAY_TOKEN");
  expect(appService).toContain("storage-socket:/run/context-use-storage:ro");
  expect(appService).toContain("networks: [dashboard_data, dashboard_web, auth_dashboard_internal, confirmation_internal]");

  const authService = deployCompose.slice(
    deployCompose.indexOf("\n  auth:\n"),
    deployCompose.indexOf("\n  private-mcp:\n"),
  );
  expect(authService).toContain("AUTH_DATABASE_URL: postgres://context_use_auth");
  expect(authService).toContain("BETTER_AUTH_SECRET");
  expect(authService).toContain("CONFIRMATION_GATEWAY_TOKEN");
  expect(authService).toContain("AUTH_DASHBOARD_TOKEN");
  expect(authService).toContain("AUTH_MCP_TOKEN");
  expect(authService).not.toContain("CONFIRMATION_DASHBOARD_TOKEN");
  expect(authService).toContain("CONFIRMATION_INTERNAL_URL: http://confirmation:3004");
  expect(authService).not.toContain("DATABASE_URL: postgres://context_use_dashboard");
  expect(authService).not.toContain("STORAGE_");
  expect(authService).not.toContain("AWS_REGION:");
  expect(authService).toContain("networks: [auth_data, auth_web, auth_dashboard_internal, auth_mcp_internal, auth_confirmation_internal]");

  const privateMcpService = deployCompose.slice(
    deployCompose.indexOf("\n  private-mcp:\n"),
    deployCompose.indexOf("\n  public-web:\n"),
  );
  expect(privateMcpService).toContain("MCP_DATABASE_URL: postgres://context_use_mcp");
  expect(privateMcpService).toContain("MCP_ASSET_CAPABILITY_SECRET");
  expect(privateMcpService).toContain("AUTH_MCP_TOKEN");
  expect(privateMcpService).not.toContain("AUTH_DASHBOARD_TOKEN");
  expect(privateMcpService).toContain("STORAGE_MCP_TOKEN");
  expect(privateMcpService).toContain("storage-socket:/run/context-use-storage:ro");
  expect(privateMcpService).not.toContain("DATABASE_URL: postgres://context_use_dashboard");
  expect(privateMcpService).not.toContain("AUTH_DATABASE_URL");
  expect(privateMcpService).not.toContain("AWS_REGION:");
  expect(privateMcpService).toContain("networks: [mcp_data, mcp_web, auth_mcp_internal]");

  const publicWebService = deployCompose.slice(
    deployCompose.indexOf("\n  public-web:\n"),
    deployCompose.indexOf("\n  confirmation:\n"),
  );
  expect(publicWebService).toContain("PUBLIC_DATABASE_URL: postgres://context_use_public");
  expect(publicWebService).toContain("STORAGE_PUBLIC_TOKEN");
  expect(publicWebService).toContain("storage-socket:/run/context-use-storage:ro");
  expect(publicWebService).not.toContain("DATABASE_URL: postgres://context_use_dashboard");
  expect(publicWebService).not.toContain("AUTH_DATABASE_URL");
  expect(publicWebService).not.toContain("AWS_REGION:");
  expect(publicWebService).toContain("networks: [public_data, public_web]");

  const confirmationService = deployCompose.slice(
    deployCompose.indexOf("\n  confirmation:\n"),
    deployCompose.indexOf("\n  storage-socket-init:\n"),
  );
  expect(confirmationService).toContain("CONFIRMATION_DATABASE_URL: postgres://context_use_confirmation");
  expect(confirmationService).toContain("CONFIRMATION_GATEWAY_TOKEN");
  expect(confirmationService).toContain("CONFIRMATION_DASHBOARD_TOKEN");
  expect(confirmationService).not.toContain("AUTH_DASHBOARD_TOKEN");
  expect(confirmationService).not.toContain("DATABASE_URL: postgres://context_use_dashboard");
  expect(confirmationService).not.toContain("AUTH_DATABASE_URL");
  expect(confirmationService).not.toContain("BETTER_AUTH_SECRET");
  expect(confirmationService).not.toContain("STORAGE_");
  expect(confirmationService).not.toContain("AWS_REGION:");
  expect(confirmationService).toContain("networks: [confirmation_data, auth_confirmation_internal, confirmation_internal]");
  expect(deployCompose).not.toContain("confirmation_web");

  const storageService = deployCompose.slice(
    deployCompose.indexOf("\n  storage:\n"),
    deployCompose.indexOf("\n  public-mcp:\n"),
  );
  expect(storageService).not.toContain("network_mode: host");
  expect(storageService).toContain("STORAGE_DATABASE_URL: postgres://context_use_storage");
  expect(storageService).toContain("STORAGE_DASHBOARD_TOKEN");
  expect(storageService).toContain("STORAGE_MCP_TOKEN");
  expect(storageService).toContain("STORAGE_PUBLIC_TOKEN");
  expect(storageService).toContain("ASSET_BUCKET");
  expect(storageService).toContain('AWS_EC2_METADATA_DISABLED: "true"');
  expect(storageService).toContain("AWS_CREDENTIALS_FILE: /run/context-use-aws-storage/credentials.json");
  expect(storageService).toContain("storage-aws-credentials:/run/context-use-aws-storage:ro");
  expect(storageService).toContain("networks: [storage_data, storage_egress]");
  expect(storageService).toContain("storage-socket:/run/context-use-storage");
  expect(storageService).not.toContain("storage-socket:/run/context-use-storage:ro");
  expect(storageService).not.toContain("DATABASE_URL: postgres://context_use_dashboard");
  expect(storageService).not.toContain("PUBLIC_DATABASE_URL");
  const credentialBroker = deployCompose.slice(
    deployCompose.indexOf("\n  aws-credential-broker:\n"),
    deployCompose.indexOf("\n  storage:\n"),
  );
  expect(credentialBroker).toContain("network_mode: host");
  expect(credentialBroker).toContain("STORAGE_ROLE_ARN");
  expect(credentialBroker).toContain("BACKUP_ROLE_ARN");
  expect(credentialBroker).not.toContain("DATABASE_URL");
  expect(credentialBroker).not.toContain("POSTGRES_PASSWORD");
  const backupService = deployCompose.slice(deployCompose.indexOf("\n  backup:\n"));
  expect(backupService).not.toContain("network_mode: host");
  expect(backupService).toContain('AWS_EC2_METADATA_DISABLED: "true"');
  expect(backupService).toContain("AWS_PROFILE: context-use-backup");
  expect(backupService).toContain("backup-aws-credentials:/run/context-use-aws-backup:ro");
  expect(backupService).toContain("networks: [backup_data, backup_egress]");
  expect(deployCompose).toContain("storage-socket-init: { condition: service_completed_successfully }");
  expect(deployCompose).toContain("storage: { condition: service_healthy }");
  expect(caddy).toContain("max_size 5GB");
  expect(caddy).toContain("max_size 3MB");
  expect(compute).toContain("s3:AbortMultipartUpload");
  expect(compute).toContain("s3:GetEncryptionConfiguration");
  expect(compute).toContain("s3:GetBucketPublicAccessBlock");
  expect(compute).toContain('resource "aws_iam_role" "storage"');
  expect(compute).toContain('resource "aws_iam_role" "backup"');
  expect(compute).toContain('Action = ["sts:AssumeRole"]');
  const instancePolicy = compute.slice(
    compute.indexOf('resource "aws_iam_role_policy" "data"'),
    compute.indexOf('resource "aws_iam_instance_profile" "app"'),
  );
  expect(instancePolicy).not.toContain("s3:");
  expect(instancePolicy).not.toContain("kms:Encrypt");
  expect(instancePolicy).not.toContain("kms:GenerateDataKey");
  expect(compute).toContain("http_put_response_hop_limit = 1");
  expect(compute).not.toContain("http_put_response_hop_limit = 2");
  expect(compute).toContain('resource "aws_route53_record" "public_mcp"');
  expect(update.indexOf("installCliRelease")).toBeLessThan(update.indexOf("readConfig"));
  expect(update.indexOf("currentComputeOutputs")).toBeLessThan(update.indexOf("run --rm backup once"));
  expect(update.match(/await saveConfig\(config\)/g)?.length).toBe(4);
  expect(data).not.toContain("aws_s3_bucket_cors_configuration");
});
