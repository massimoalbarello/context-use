import { resolve4 } from "node:dns/promises";
import { resolve } from "node:path";
import { sendSsmCommands, waitForSsm } from "./aws.ts";
import { markDataVolumeInitialized } from "./data-volume.ts";
import { probeInternalNangoReady, verifyExternalNangoBoundary } from "./nango-internal.ts";
import { deploymentRoot } from "./release.ts";
import type { ComputeOutputs, DataOutputs, DeploymentConfig, ReleaseManifest } from "./types.ts";

export async function deploy(
  config: DeploymentConfig,
  compute: ComputeOutputs,
  manifest: ReleaseManifest,
  options: {
    recoveryBackupKey?: string;
    recoveryNangoBackupKey?: string;
    installTemplate?: string;
  } = {},
): Promise<void> {
  await assertManualDns(config, compute);
  const deployScript = await Bun.file(resolve(await deploymentRoot(manifest), "deploy/deploy.sh")).text();
  const command = deploymentCommands(config, manifest, deployScript, options);
  await sendSsmCommands(config.awsProfile, config.awsRegion, compute.instance_id, command);
  await verifyDeployment(config, manifest.version, compute.instance_id);
}

export function computeBootstrapCommands(): string[] {
  return [
    "if cloud-init status --wait; then exit 0; fi",
    "cloud-init status --long || true",
    "tail -n 100 /var/log/cloud-init-output.log >&2 || true",
    "exit 1",
  ];
}

export async function prepareCompute(config: DeploymentConfig, data: DataOutputs, compute: ComputeOutputs): Promise<void> {
  await waitForSsm(config.awsProfile, config.awsRegion, compute.instance_id);
  await sendSsmCommands(
    config.awsProfile,
    config.awsRegion,
    compute.instance_id,
    computeBootstrapCommands(),
  );
  await markDataVolumeInitialized(config, data);
}

export function nangoPipelineRuntimeCommands(config: DeploymentConfig): string[] {
  const prefix = `/context-use/${config.installationId}/${config.environment}`;
  if (!/^\/context-use\/[a-z0-9-]+\/[a-z0-9-]+$/.test(prefix)) {
    throw new Error("Invalid Nango pipeline parameter prefix");
  }
  const parameter = `${prefix}/NANGO_PIPELINE_API_KEY`;
  const runtimeEnv = "/data/context-use/secrets/runtime.env";
  const compose = `docker compose --env-file ${runtimeEnv}`;
  return [
    "set -euo pipefail",
    `runtime_env='${runtimeEnv}'`,
    'test -s "$runtime_env"',
    `pipeline_key="$(aws ssm get-parameter --name '${parameter}' --with-decryption --query Parameter.Value --output text)"`,
    "test -n \"$pipeline_key\" || { echo 'Nango pipeline key is empty' >&2; exit 2; }",
    "case \"$pipeline_key\" in *$'\\n'*|*$'\\r'*) echo 'Invalid Nango pipeline key' >&2; exit 2;; esac",
    "temporary_env=\"$(mktemp /data/context-use/secrets/runtime.env.XXXXXX)\"",
    "trap 'rm -f \"$temporary_env\"' EXIT",
    "awk -F= '$1 != \"NANGO_PIPELINE_API_KEY\"' \"$runtime_env\" > \"$temporary_env\"",
    "printf '%s\\n' \"NANGO_PIPELINE_API_KEY=$pipeline_key\" >> \"$temporary_env\"",
    'chmod 0600 "$temporary_env"',
    'mv "$temporary_env" "$runtime_env"',
    "trap - EXIT",
    "cd /opt/context-use/deploy",
    `${compose} up -d --wait --force-recreate --no-deps private-mcp`,
  ];
}

export async function refreshNangoPipelineRuntime(
  config: DeploymentConfig,
  compute: ComputeOutputs,
): Promise<void> {
  await sendSsmCommands(
    config.awsProfile,
    config.awsRegion,
    compute.instance_id,
    nangoPipelineRuntimeCommands(config),
  );
}

export async function manualDnsMismatches(
  config: DeploymentConfig,
  compute: ComputeOutputs,
  resolver: (hostname: string) => Promise<string[]> = resolve4,
): Promise<string[]> {
  if (config.dnsMode !== "manual") return [];
  return dnsMismatches(config, compute, resolver);
}

export async function dnsMismatches(
  config: DeploymentConfig,
  compute: ComputeOutputs,
  resolver: (hostname: string) => Promise<string[]> = resolve4,
): Promise<string[]> {
  const hostnames = [...new Set([config.hostname, config.assetHostname, config.nangoHostname])];
  const matches = await Promise.all(hostnames.map(async (hostname) => {
    try {
      return (await resolver(hostname)).includes(compute.public_ip);
    } catch {
      return false;
    }
  }));
  return hostnames.filter((_, index) => !matches[index]);
}

async function assertManualDns(config: DeploymentConfig, compute: ComputeOutputs): Promise<void> {
  const missing = await manualDnsMismatches(config, compute);
  if (missing.length === 0) return;
  throw new Error(
    `Create A records for ${missing.join(", ")} pointing to ${compute.public_ip}, wait for DNS propagation, then rerun the command`,
  );
}

export async function deployedRuntimePresent(config: DeploymentConfig, compute: ComputeOutputs): Promise<boolean> {
  const result = await sendSsmCommands(config.awsProfile, config.awsRegion, compute.instance_id, [
    "if test -s /data/context-use/secrets/runtime.env && test -f /opt/context-use/deploy/docker-compose.yml; then echo present; else echo absent; fi",
  ]);
  return result.trim() === "present";
}

export function deploymentCommands(
  config: DeploymentConfig,
  manifest: ReleaseManifest,
  deployScript: string,
  options: {
    recoveryBackupKey?: string;
    recoveryNangoBackupKey?: string;
    installTemplate?: string;
  } = {},
): string[] {
  const { recoveryBackupKey, recoveryNangoBackupKey, installTemplate } = options;
  if (recoveryBackupKey && !/^postgres\/[0-9TZ-]+\.sql\.gz$/.test(recoveryBackupKey)) {
    throw new Error("Invalid recovery backup key");
  }
  if (recoveryNangoBackupKey && !/^nango-postgres\/[0-9TZ-]+\.sql\.gz$/.test(recoveryNangoBackupKey)) {
    throw new Error("Invalid Nango recovery backup key");
  }
  if (installTemplate && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(installTemplate)) {
    throw new Error("Invalid knowledge template name");
  }
  const encoded = Buffer.from(deployScript).toString("base64");
  const rolePrefix = `context-use-${config.installationId}-${config.environment}`;
  const storageRoleArn = `arn:aws:iam::${config.accountId}:role/${rolePrefix}-storage`;
  const backupRoleArn = `arn:aws:iam::${config.accountId}:role/${rolePrefix}-backup`;
  return [
    "trap 'rm -f /tmp/context-use-deploy.sh' EXIT",
    `echo '${encoded}' | base64 -d > /tmp/context-use-deploy.sh`,
    "chmod 0700 /tmp/context-use-deploy.sh",
    `CONTEXT_USE_VERSION='${manifest.version}' CONTEXT_USE_ENVIRONMENT='${config.environment}' CONTEXT_USE_BUNDLE_URL='${manifest.deployment_bundle.url}' CONTEXT_USE_BUNDLE_SHA256='${manifest.deployment_bundle.sha256}' CONTEXT_USE_APP_IMAGE='${manifest.images.app}' CONTEXT_USE_BACKUP_IMAGE='${manifest.images.backup}' CONTEXT_USE_PARAMETER_PREFIX='/context-use/${config.installationId}/${config.environment}' CONTEXT_USE_STORAGE_ROLE_ARN='${storageRoleArn}' CONTEXT_USE_BACKUP_ROLE_ARN='${backupRoleArn}'${recoveryBackupKey ? ` CONTEXT_USE_RECOVERY_BACKUP_KEY='${recoveryBackupKey}'` : ""}${recoveryNangoBackupKey ? ` CONTEXT_USE_RECOVERY_NANGO_BACKUP_KEY='${recoveryNangoBackupKey}'` : ""}${installTemplate ? ` CONTEXT_USE_TEMPLATE_INSTALL='${installTemplate}'` : ""} /tmp/context-use-deploy.sh`,
  ];
}

export function healthMatchesVersion(health: unknown, releaseVersion: string): boolean {
  if (!health || typeof health !== "object" || !("version" in health)) return false;
  return health.version === releaseVersion.replace(/^v/, "");
}

export async function verifyDeployment(config: DeploymentConfig, releaseVersion: string, instanceId: string): Promise<void> {
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
  const landing = await fetch(origin);
  const landingHtml = await landing.text();
  if (!landing.ok
      || !landingHtml.includes('href="/p/about/intro"')) {
    throw new Error("The public billboard is unavailable or incomplete");
  }
  const about = await fetch(`${origin}/p/about/intro`);
  if (!about.ok) throw new Error("The public About empty state is unavailable");
  const [robots, sitemap, llms] = await Promise.all([
    fetch(`${origin}/robots.txt`),
    fetch(`${origin}/sitemap.xml`),
    fetch(`${origin}/llms.txt`),
  ]);
  const [robotsText, sitemapXml, llmsText] = await Promise.all([
    robots.text(),
    sitemap.text(),
    llms.text(),
  ]);
  if (!robots.ok || !robotsText.includes(`Sitemap: ${origin}/sitemap.xml`)) {
    throw new Error("Public crawler discovery is unavailable or incomplete");
  }
  if (!sitemap.ok || !sitemapXml.includes("<urlset")) {
    throw new Error("The public sitemap is unavailable or incomplete");
  }
  if (!llms.ok || !llmsText.includes(`${origin}/llms-full.txt`)) {
    throw new Error("The AI-readable public index is unavailable or incomplete");
  }

  let nangoError = "health check did not complete";
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if (await probeInternalNangoReady(config, instanceId)) {
        // Scoped API keys are provisioned immediately after deploy returns.
        // This pass proves anonymous and native-Basic isolation; provisioning
        // performs the mandatory real scoped-bearer bypass test.
        await verifyExternalNangoBoundary(config, instanceId, {}, { requireManagedApiKey: false });
        return;
      }
      nangoError = "internal readiness check failed";
    } catch (error) {
      nangoError = error instanceof Error ? error.message : String(error);
    }
    if (attempt < 59) await Bun.sleep(3_000);
  }
  throw new Error(`Nango did not become ready: ${nangoError}`);
}
