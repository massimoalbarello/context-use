import * as p from "@clack/prompts";
import { createHash } from "node:crypto";
import { accountId, bootstrapStateBucket, configureStateBucketKms, createStateKmsKey, generateSecret, putSecureParameter } from "./aws.ts";
import { deploy } from "./deploy.ts";
import { configPath, saveConfig } from "./paths.ts";
import { commandExists } from "./process.ts";
import { deploymentRoot, releaseManifest } from "./release.ts";
import { applyCompute, applyData, assertTerraformVersion } from "./terraform.ts";
import type { DeploymentConfig } from "./types.ts";

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

export async function storeRuntimeParameters(config: DeploymentConfig, googleSecret: string): Promise<void> {
  if (!config.dataOutputs || !config.computeOutputs) throw new Error("Infrastructure outputs missing");
  const prefix = `/context-use/${config.installationId}/${config.environment}`;
  const generated: Record<string, string> = {
    APP_HOSTNAME: config.hostname,
    ASSET_HOSTNAME: config.assetHostname,
    OWNER_EMAIL: config.ownerEmail,
    GOOGLE_CLIENT_ID: config.googleClientId,
    GOOGLE_CLIENT_SECRET: googleSecret,
    BETTER_AUTH_SECRET: generateSecret(48),
    POSTGRES_PASSWORD: generateSecret(36),
    DB_AUTH_PASSWORD: generateSecret(36),
    DB_DASHBOARD_PASSWORD: generateSecret(36),
    DB_MCP_PASSWORD: generateSecret(36),
    DB_PUBLIC_PASSWORD: generateSecret(36),
    DB_PUBLISHER_PASSWORD: generateSecret(36),
    DB_BACKUP_PASSWORD: generateSecret(36),
    AWS_REGION: config.awsRegion,
    ASSET_BUCKET: config.dataOutputs.asset_bucket,
    BACKUP_BUCKET: config.dataOutputs.backup_bucket,
    KMS_KEY_ID: config.dataOutputs.kms_key_arn,
    CLOUDWATCH_LOG_GROUP: config.computeOutputs.cloudwatch_log_group,
    BACKUP_RETENTION_DAYS: String(config.backupRetentionDays),
  };
  const progress = p.progress({ max: Object.keys(generated).length });
  progress.start("Storing encrypted runtime parameters");
  for (const [name, secret] of Object.entries(generated)) {
    await putSecureParameter(config.awsProfile, config.awsRegion, `${prefix}/${name}`, secret, config.dataOutputs.kms_key_arn);
    progress.advance(1);
  }
  progress.stop("Encrypted runtime parameters stored");
  config.parametersReady = true;
  await saveConfig(config);
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
  const ownerEmail = required(await p.text({ message: "Verified Google owner email", validate: (input) => input && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input) ? undefined : "Enter a valid email" }), "Owner email").trim().toLowerCase();
  p.note("context-use has no analytics or telemetry. Google receives authentication traffic, and the certificate authority receives the two configured hostnames.", "External services");
  const googleClientId = required(await p.text({ message: "Google OAuth client ID", validate: (input) => input && /^[A-Za-z0-9._-]+$/.test(input) ? undefined : "Enter the Google client ID" }), "Google client ID");
  const googleClientSecret = required(await p.password({ message: "Google OAuth client secret", validate: (input) => input && /^[A-Za-z0-9._-]+$/.test(input) ? undefined : "Enter the Google client secret" }), "Google client secret");
  const manifest = await releaseManifest(process.env.CONTEXT_USE_VERSION ?? "latest");
  const config: DeploymentConfig = {
    schemaVersion: 1, releaseVersion: manifest.version, phase: "new", environment: "production",
    installationId: createHash("sha256").update(`${identity}:${awsRegion}:${hostname}`).digest("hex").slice(0, 12),
    awsProfile, awsRegion, availabilityZone: `${awsRegion}a`, accountId: identity,
    hostname, assetHostname: `assets.${hostname}`, dnsMode, route53ZoneId, ownerEmail,
    googleClientId, parametersReady: false,
    stateBucket: `context-use-${identity}-${awsRegion}-${createHash("sha256").update(hostname).digest("hex").slice(0, 10)}-tfstate`, instanceType: "t3.small",
    dataVolumeSizeGb: 50, backupRetentionDays: 30,
  };
  await assertTerraformVersion(manifest);
  const root = await deploymentRoot(manifest);
  await saveConfig(config);
  await bootstrapStateBucket(awsProfile, awsRegion, config.stateBucket);
  const stateKey = await createStateKmsKey(awsProfile, awsRegion, config.installationId);
  config.stateKmsKeyArn = stateKey.arn;
  config.stateKmsKeyId = stateKey.id;
  await saveConfig(config);
  await configureStateBucketKms(config.awsProfile, config.awsRegion, config.stateBucket, stateKey.arn);
  config.dataOutputs = await applyData(root, config);
  config.phase = "data_ready"; await saveConfig(config);
  config.computeOutputs = await applyCompute(root, config);
  config.phase = "compute_ready"; await saveConfig(config);
  await storeRuntimeParameters(config, googleClientSecret);
  if (dnsMode === "manual") {
    config.phase = "awaiting_dns"; await saveConfig(config);
    p.note(`Create these A records pointing to ${config.computeOutputs.public_ip}:\n${config.hostname}\n${config.assetHostname}\n\nThen run: context-use resume`, "DNS required");
    return;
  }
  await deploy(config, manifest);
  config.phase = "deployed"; await saveConfig(config);
  p.outro(`context-use is ready at https://${config.hostname}/app`);
}
