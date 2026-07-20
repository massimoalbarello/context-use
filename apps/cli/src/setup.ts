import * as p from "@clack/prompts";
import { createHash } from "node:crypto";
import { accountId, bootstrapStateBucket, generateSecret, getSecureParameter, getSecureParameterIfPresent, putSecureParameter } from "./aws.ts";
import { deploy, manualDnsMismatches, prepareCompute } from "./deploy.ts";
import { configPath, saveConfig } from "./paths.ts";
import { commandExists } from "./process.ts";
import { deploymentRoot, releaseManifest } from "./release.ts";
import { applyCompute, applyData, assertTerraformVersion, currentComputeOutputs } from "./terraform.ts";
import type { ComputeOutputs, DataOutputs, DeploymentConfig } from "./types.ts";

function value<T>(result: T | symbol): T {
  if (p.isCancel(result)) { p.cancel("Setup cancelled"); process.exit(0); }
  return result as T;
}

function required(result: string | symbol | undefined, label: string): string {
  if (p.isCancel(result)) { p.cancel("Setup cancelled"); process.exit(0); }
  if (!result) throw new Error(`${label} is required`);
  return result;
}

function validHostname(input: string | undefined): boolean {
  if (!input || input.length > 240 || input.includes("..")) return false;
  return input.split(".").every((label) => label.length > 0 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label));
}

export async function ensureRuntimeParameters(config: DeploymentConfig, data: DataOutputs, compute: ComputeOutputs): Promise<void> {
  const prefix = `/context-use/${config.installationId}/${config.environment}`;
  const fixed: Record<string, string> = {
    APP_HOSTNAME: config.hostname,
    ASSET_HOSTNAME: config.assetHostname,
    OWNER_EMAIL: config.ownerEmail,
    AWS_REGION: config.awsRegion,
    ASSET_BUCKET: data.asset_bucket,
    BACKUP_BUCKET: data.backup_bucket,
    KMS_KEY_ID: data.kms_key_arn,
    CLOUDWATCH_LOG_GROUP: compute.cloudwatch_log_group,
  };
  const secrets = {
    BETTER_AUTH_SECRET: 48,
    POSTGRES_PASSWORD: 36,
    DB_AUTH_PASSWORD: 36,
    DB_DASHBOARD_PASSWORD: 36,
    DB_MCP_PASSWORD: 36,
    DB_PUBLIC_PASSWORD: 36,
    DB_CONFIRMATION_PASSWORD: 36,
    DB_STORAGE_PASSWORD: 36,
    DB_BACKUP_PASSWORD: 36,
    MCP_ASSET_CAPABILITY_SECRET: 48,
    CONFIRMATION_GATEWAY_TOKEN: 48,
    AUTH_DASHBOARD_TOKEN: 48,
    AUTH_MCP_TOKEN: 48,
    CONFIRMATION_DASHBOARD_TOKEN: 48,
    STORAGE_DASHBOARD_TOKEN: 48,
    STORAGE_MCP_TOKEN: 48,
    STORAGE_PUBLIC_TOKEN: 48,
  } as const;
  const progress = p.progress({ max: Object.keys(fixed).length + Object.keys(secrets).length + 2 });
  progress.start("Storing encrypted runtime parameters");
  for (const [name, value] of Object.entries(fixed)) {
    const parameter = `${prefix}/${name}`;
    if (await getSecureParameterIfPresent(config.awsProfile, config.awsRegion, parameter) !== value) {
      await putSecureParameter(config.awsProfile, config.awsRegion, parameter, value, data.kms_key_arn);
    }
    progress.advance(1);
  }
  for (const [name, length] of Object.entries(secrets)) {
    const parameter = `${prefix}/${name}`;
    if (!await getSecureParameterIfPresent(config.awsProfile, config.awsRegion, parameter)) {
      await putSecureParameter(config.awsProfile, config.awsRegion, parameter, generateSecret(length), data.kms_key_arn);
    }
    progress.advance(1);
  }
  const tokenName = `${prefix}/OWNER_SETUP_TOKEN`;
  const storedOwnerSetupToken = await getSecureParameterIfPresent(config.awsProfile, config.awsRegion, tokenName);
  const ownerSetupToken = storedOwnerSetupToken ?? generateSecret(32);
  if (!storedOwnerSetupToken) {
    await putSecureParameter(config.awsProfile, config.awsRegion, tokenName, ownerSetupToken, data.kms_key_arn);
  }
  progress.advance(1);
  const tokenHashName = `${prefix}/OWNER_SETUP_TOKEN_HASH`;
  const tokenHash = createHash("sha256").update(ownerSetupToken).digest("hex");
  if (await getSecureParameterIfPresent(config.awsProfile, config.awsRegion, tokenHashName) !== tokenHash) {
    await putSecureParameter(config.awsProfile, config.awsRegion, tokenHashName, tokenHash, data.kms_key_arn);
  }
  progress.advance(1);
  progress.stop("Encrypted runtime parameters stored");
}

export async function ownerSetupUrl(config: DeploymentConfig): Promise<string> {
  const prefix = `/context-use/${config.installationId}/${config.environment}`;
  const token = await getSecureParameter(config.awsProfile, config.awsRegion, `${prefix}/OWNER_SETUP_TOKEN`);
  return `https://${config.hostname}/app#setup=${encodeURIComponent(token)}`;
}

export async function pauseForManualDns(config: DeploymentConfig, compute: ComputeOutputs, nextCommand = "resume"): Promise<boolean> {
  const missing = await manualDnsMismatches(config, compute);
  if (missing.length === 0) return false;
  p.note(`Create these A records pointing to ${compute.public_ip}:\n${missing.join("\n")}\n\nThen run: context-use ${nextCommand}`, "DNS required");
  return true;
}

export async function setup(): Promise<void> {
  p.intro("context-use · private knowledge infrastructure");
  if (await Bun.file(configPath).exists()) {
    throw new Error(`A deployment config already exists at ${configPath}. Use resume/status/destroy instead of overwriting it.`);
  }
  if (!(await commandExists("aws")) || !(await commandExists("terraform")) || !(await commandExists("gh"))) {
    throw new Error("AWS CLI, Terraform, and GitHub CLI are required. Install them and try again.");
  }
  const awsProfile = required(await p.text({ message: "AWS profile", defaultValue: process.env.AWS_PROFILE ?? "default" }), "AWS profile");
  const awsRegion = required(await p.text({ message: "AWS region", defaultValue: "eu-west-2" }), "AWS region");
  const identity = await accountId(awsProfile, awsRegion);
  p.log.success(`Authenticated to AWS account ${identity}`);
  const hostname = required(await p.text({ message: "Dashboard hostname", placeholder: "context.example.com", validate: (input) => validHostname(input) ? undefined : "Enter a valid lowercase hostname" }), "Hostname");
  const dnsMode = value(await p.select({ message: "DNS management", options: [{ value: "route53", label: "Route 53 (automatic)" }, { value: "manual", label: "Manual DNS" }] })) as "route53" | "manual";
  const route53ZoneId = dnsMode === "route53" ? required(await p.text({ message: "Route 53 hosted zone ID" }), "Route 53 zone ID") : "";
  const ownerEmail = required(await p.text({ message: "Owner email", validate: (input) => input && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input) ? undefined : "Enter a valid email" }), "Owner email").trim().toLowerCase();
  const manifest = await releaseManifest(process.env.CONTEXT_USE_VERSION ?? "latest");
  const config: DeploymentConfig = {
    schemaVersion: 2, releaseVersion: manifest.version, environment: "production",
    installationId: createHash("sha256").update(`${identity}:${awsRegion}:${hostname}`).digest("hex").slice(0, 12),
    awsProfile, awsRegion, availabilityZone: `${awsRegion}a`, accountId: identity,
    hostname,
    assetHostname: `assets.${hostname}`,
    dnsMode,
    route53ZoneId,
    ownerEmail,
    stateBucket: `context-use-${identity}-${awsRegion}-${createHash("sha256").update(hostname).digest("hex").slice(0, 10)}-tfstate`, instanceType: "t3.small",
    dataVolumeSizeGb: 50, backupRetentionDays: 30,
  };
  await assertTerraformVersion(manifest);
  const root = await deploymentRoot(manifest);
  await saveConfig(config);
  await bootstrapStateBucket(awsProfile, awsRegion, config.stateBucket);
  const data = await applyData(root, config);
  const compute = await currentComputeOutputs(root, config) ?? await applyCompute(root, config, data, true);
  await prepareCompute(config, data, compute);
  await ensureRuntimeParameters(config, data, compute);
  if (await pauseForManualDns(config, compute)) return;
  await deploy(config, compute, manifest);
  p.outro(`context-use is ready. Create the owner passkey:\n${await ownerSetupUrl(config)}`);
}
