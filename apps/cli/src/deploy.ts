import { resolve4 } from "node:dns/promises";
import { resolve } from "node:path";
import { sendSsmCommands, waitForSsm } from "./aws.ts";
import { markDataVolumeInitialized } from "./data-volume.ts";
import { currentVersion, deploymentRoot } from "./release.ts";
import type { ComputeOutputs, DataOutputs, DeploymentConfig, ReleaseManifest } from "./types.ts";

export async function deploy(
  config: DeploymentConfig,
  compute: ComputeOutputs,
  manifest: ReleaseManifest,
  recoveryBackupKey?: string,
): Promise<void> {
  const expectPublicMcp = manifest.version === currentVersion;
  await assertManualDns(config, compute);
  const deployScript = await Bun.file(resolve(await deploymentRoot(manifest), "deploy/deploy.sh")).text();
  const command = deploymentCommands(config, manifest, deployScript, recoveryBackupKey);
  await sendSsmCommands(config.awsProfile, config.awsRegion, compute.instance_id, command);
  await verifyDeployment(config, manifest.version, expectPublicMcp);
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

export async function publicMcpDnsMatches(
  config: DeploymentConfig,
  compute: ComputeOutputs,
  resolver: (hostname: string) => Promise<string[]> = resolve4,
): Promise<boolean> {
  return !(await manualDnsMismatches(config, compute, resolver)).includes(config.publicMcpHostname);
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
  const hostnames = [config.hostname, config.assetHostname, config.publicMcpHostname];
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
  recoveryBackupKey?: string,
): string[] {
  if (recoveryBackupKey && !/^postgres\/[0-9TZ-]+\.sql\.gz$/.test(recoveryBackupKey)) {
    throw new Error("Invalid recovery backup key");
  }
  const encoded = Buffer.from(deployScript).toString("base64");
  const rolePrefix = `context-use-${config.installationId}-${config.environment}`;
  const storageRoleArn = `arn:aws:iam::${config.accountId}:role/${rolePrefix}-storage`;
  const backupRoleArn = `arn:aws:iam::${config.accountId}:role/${rolePrefix}-backup`;
  return [
    "trap 'rm -f /tmp/context-use-deploy.sh' EXIT",
    `echo '${encoded}' | base64 -d > /tmp/context-use-deploy.sh`,
    "chmod 0700 /tmp/context-use-deploy.sh",
    `CONTEXT_USE_VERSION='${manifest.version}' CONTEXT_USE_ENVIRONMENT='${config.environment}' CONTEXT_USE_BUNDLE_URL='${manifest.deployment_bundle.url}' CONTEXT_USE_BUNDLE_SHA256='${manifest.deployment_bundle.sha256}' CONTEXT_USE_APP_IMAGE='${manifest.images.app}' CONTEXT_USE_BACKUP_IMAGE='${manifest.images.backup}' CONTEXT_USE_PARAMETER_PREFIX='/context-use/${config.installationId}/${config.environment}' CONTEXT_USE_STORAGE_ROLE_ARN='${storageRoleArn}' CONTEXT_USE_BACKUP_ROLE_ARN='${backupRoleArn}'${recoveryBackupKey ? ` CONTEXT_USE_RECOVERY_BACKUP_KEY='${recoveryBackupKey}'` : ""} /tmp/context-use-deploy.sh`,
  ];
}

export function healthMatchesVersion(health: unknown, releaseVersion: string): boolean {
  if (!health || typeof health !== "object" || !("version" in health)) return false;
  return health.version === releaseVersion.replace(/^v/, "");
}

export async function verifyDeployment(config: DeploymentConfig, releaseVersion: string, expectPublicMcp = true): Promise<void> {
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
      || !landingHtml.includes('href="/p/about/intro"')
      || !landingHtml.includes(`${publicOrigin}/mcp`)) {
    throw new Error("The public billboard is unavailable or incomplete");
  }
  const about = await fetch(`${origin}/p/about/intro`);
  if (!about.ok) throw new Error("The public About empty state is unavailable");
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
