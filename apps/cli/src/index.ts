#!/usr/bin/env bun
import * as p from "@clack/prompts";
import { Command } from "commander";
import { bootstrapStateBucket, configureStateBucketKms, createStateKmsKey, deleteParameterPath, deleteStateBucket, emptyVersionedBucket, listBackups, scheduleStateKmsKeyDeletion, sendSsmCommands } from "./aws.ts";
import { deploy, verifyRemoteSecurity } from "./deploy.ts";
import { configPath, readConfig, saveConfig } from "./paths.ts";
import { commandExists, run } from "./process.ts";
import { currentVersion, deploymentRoot, releaseManifest } from "./release.ts";
import { setup, storeRuntimeParameters } from "./setup.ts";
import { applyCompute, applyData, assertTerraformVersion, destroyCompute, destroyData } from "./terraform.ts";

const program = new Command().name("context-use").description("Deploy and maintain a private context-use knowledge base").version(currentVersion);

program.command("version").description("Print the context-use CLI version").action(() => {
  console.log(currentVersion);
});

program.command("setup").description("Create a new AWS deployment").action(setup);

program.command("resume").description("Continue an interrupted setup").action(async () => {
  const config = await readConfig();
  if (config.phase === "purged") throw new Error("This installation was permanently purged; remove the local config before starting a new setup");
  const manifest = await releaseManifest(config.releaseVersion);
  await assertTerraformVersion(manifest);
  const root = await deploymentRoot(manifest);
  await bootstrapForResume(config);
  if (!config.dataOutputs) { config.dataOutputs = await applyData(root, config); config.phase = "data_ready"; await saveConfig(config); }
  if (!config.computeOutputs) { config.computeOutputs = await applyCompute(root, config); config.phase = "compute_ready"; await saveConfig(config); }
  if (!config.parametersReady) {
    const secret = await p.password({ message: "Google OAuth client secret (needed to finish interrupted setup)" });
    if (p.isCancel(secret) || !secret) throw new Error("Google OAuth client secret is required");
    await storeRuntimeParameters(config, secret);
  }
  await deploy(config, manifest);
  config.phase = "deployed"; await saveConfig(config);
  p.outro(`context-use is ready at https://${config.hostname}/app`);
});

program.command("status").description("Show deployment status").action(async () => {
  const config = await readConfig();
  console.log(JSON.stringify({ phase: config.phase, version: config.releaseVersion, url: `https://${config.hostname}/app`, instance: config.computeOutputs?.instance_id, publicIp: config.computeOutputs?.public_ip }, null, 2));
});

program.command("doctor").description("Check local, AWS, DNS, TLS, and application health").action(async () => {
  const config = await readConfig();
  const checks: Array<[string, () => Promise<unknown>]> = [
    ["AWS CLI", async () => { if (!(await commandExists("aws"))) throw new Error("not installed"); }],
    ["Terraform", async () => { if (!(await commandExists("terraform"))) throw new Error("not installed"); }],
    ["GitHub CLI", async () => { if (!(await commandExists("gh"))) throw new Error("not installed"); }],
    ["AWS identity", () => run(["aws", "--profile", config.awsProfile, "--region", config.awsRegion, "sts", "get-caller-identity"], { quiet: true })],
    ["DNS", () => run(["dig", "+short", config.hostname], { quiet: true })],
    ["HTTPS health", async () => { const response = await fetch(`https://${config.hostname}/api/health`); if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); }],
    ["MCP metadata", async () => { const response = await fetch(`https://${config.hostname}/.well-known/oauth-protected-resource/mcp`); if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); }],
    ["Remote database, S3, and backup isolation", () => verifyRemoteSecurity(config)],
  ];
  let failed = 0;
  for (const [name, check] of checks) {
    try { const value = await check(); p.log.success(`${name}${value === false || value === "" ? " unavailable" : " OK"}`); }
    catch (error) { failed += 1; p.log.error(`${name}: ${error instanceof Error ? error.message : "failed"}`); }
  }
  if (failed) throw new Error(`${failed} diagnostic check${failed === 1 ? "" : "s"} failed`);
});

program.command("update").option("--version <version>", "Release to install", "latest").description("Back up and deploy a release").action(async ({ version }) => {
  const config = await readConfig();
  if (!config.computeOutputs) throw new Error("No active compute deployment");
  await sendSsmCommands(config.awsProfile, config.awsRegion, config.computeOutputs.instance_id, ["cd /opt/context-use/deploy && docker compose --env-file /data/context-use/secrets/runtime.env run --rm backup once"]);
  const manifest = await releaseManifest(version);
  await assertTerraformVersion(manifest);
  const root = await deploymentRoot(manifest);
  config.dataOutputs = await applyData(root, config);
  config.computeOutputs = await applyCompute(root, config);
  try {
    await deploy(config, manifest);
  } catch (error) {
    p.log.error("Update health checks failed; rolling back the application images");
    const previous = await releaseManifest(config.releaseVersion);
    await deploy(config, previous);
    throw error;
  }
  config.releaseVersion = manifest.version; config.phase = "deployed"; await saveConfig(config);
  p.outro(`Updated to ${manifest.version}`);
});

program.command("backup").description("Create a verified database backup now").action(async () => {
  const config = await readConfig(); if (!config.computeOutputs) throw new Error("No active instance");
  await sendSsmCommands(config.awsProfile, config.awsRegion, config.computeOutputs.instance_id, ["cd /opt/context-use/deploy && docker compose --env-file /data/context-use/secrets/runtime.env run --rm backup once"]);
  p.outro("Backup completed");
});

program.command("restore").description("Restore PostgreSQL from an encrypted backup").action(async () => {
  const config = await readConfig();
  if (!config.computeOutputs || !config.dataOutputs) throw new Error("No active deployment");
  const backups = await listBackups(config.awsProfile, config.awsRegion, config.dataOutputs.backup_bucket);
  if (backups.length === 0) throw new Error("No PostgreSQL backups are available");
  const selected = await p.select({
    message: "Backup to restore",
    options: backups.slice(0, 100).map((backup) => ({
      value: backup.key,
      label: `${backup.modified} · ${(backup.size / 1_048_576).toFixed(1)} MiB`,
    })),
  });
  if (p.isCancel(selected)) throw new Error("Restore cancelled");
  if (!/^postgres\/[0-9TZ-]+\.sql\.gz$/.test(selected)) throw new Error("Invalid backup key");
  const typed = await p.text({ message: `Type ${config.hostname} to replace the live database` });
  if (p.isCancel(typed) || typed !== config.hostname) throw new Error("Confirmation did not match");
  const commands = [
    "set -euo pipefail",
    "cd /opt/context-use/deploy",
    "docker compose --env-file /data/context-use/secrets/runtime.env run --rm backup once",
    "docker compose --env-file /data/context-use/secrets/runtime.env stop app backup",
    `aws s3 cp 's3://${config.dataOutputs.backup_bucket}/${selected}' - --only-show-errors | gunzip | docker compose --env-file /data/context-use/secrets/runtime.env exec -T postgres psql -v ON_ERROR_STOP=1 -U postgres -d context_use`,
    "docker compose --env-file /data/context-use/secrets/runtime.env up -d app backup",
  ];
  await sendSsmCommands(config.awsProfile, config.awsRegion, config.computeOutputs.instance_id, commands);
  p.outro(`Database restored from ${selected}`);
});

program.command("open").description("Open the dashboard").action(async () => {
  const config = await readConfig();
  Bun.spawn([process.platform === "darwin" ? "open" : "xdg-open", `https://${config.hostname}/app`]);
});

program.command("auth").command("recover-passkey").description("Start owner-controlled passkey recovery through AWS").action(async () => {
  const config = await readConfig(); if (!config.computeOutputs) throw new Error("No active instance");
  const output = await sendSsmCommands(config.awsProfile, config.awsRegion, config.computeOutputs.instance_id, ["cd /opt/context-use/deploy && docker compose --env-file /data/context-use/secrets/runtime.env exec -T app bun apps/server/src/recover-passkey.ts"]);
  console.log(output.trim());
});

program.command("destroy").option("--purge-data", "Also permanently destroy retained data").description("Remove compute while preserving data by default").action(async ({ purgeData }) => {
  const config = await readConfig();
  if (config.phase === "purged") throw new Error("This installation has already been permanently purged");
  const typed = await p.text({ message: purgeData ? `Type ${config.hostname} to permanently destroy all data` : `Type ${config.hostname} to destroy compute while preserving data` });
  if (p.isCancel(typed) || typed !== config.hostname) throw new Error("Confirmation did not match");
  const manifest = await releaseManifest(config.releaseVersion);
  await assertTerraformVersion(manifest);
  const root = await deploymentRoot(manifest);
  if (config.computeOutputs) await destroyCompute(root, config);
  delete config.computeOutputs; config.phase = "destroyed"; await saveConfig(config);
  if (purgeData) {
    const confirmed = await p.confirm({ message: "Final confirmation: permanently delete every page, asset, backup, secret, and encryption key?", initialValue: false });
    if (p.isCancel(confirmed) || !confirmed) throw new Error("Permanent purge cancelled; compute was removed but data is retained");
    if (!config.dataOutputs) throw new Error("Data outputs are missing; refusing an unverifiable purge");
    await emptyVersionedBucket(config.awsProfile, config.awsRegion, config.dataOutputs.asset_bucket);
    await emptyVersionedBucket(config.awsProfile, config.awsRegion, config.dataOutputs.backup_bucket);
    await deleteParameterPath(config.awsProfile, config.awsRegion, `/context-use/${config.installationId}/${config.environment}`);
    await destroyData(root, config);
    await deleteStateBucket(config.awsProfile, config.awsRegion, config.stateBucket);
    if (config.stateKmsKeyArn) await scheduleStateKmsKeyDeletion(config.awsProfile, config.awsRegion, config.installationId, config.stateKmsKeyArn);
    delete config.dataOutputs; config.phase = "purged"; await saveConfig(config);
    p.outro("All context-use infrastructure and retained data were destroyed. The KMS key is scheduled for deletion after its safety window.");
    return;
  }
  p.outro(`Compute destroyed. Encrypted data and state remain in AWS. Config: ${configPath}`);
});

program.parseAsync().catch((error) => {
  p.log.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function bootstrapForResume(config: Awaited<ReturnType<typeof readConfig>>): Promise<void> {
  await bootstrapStateBucket(config.awsProfile, config.awsRegion, config.stateBucket);
  if (!config.stateKmsKeyArn) {
    const key = await createStateKmsKey(config.awsProfile, config.awsRegion, config.installationId);
    config.stateKmsKeyArn = key.arn;
    config.stateKmsKeyId = key.id;
    await saveConfig(config);
  }
  await configureStateBucketKms(config.awsProfile, config.awsRegion, config.stateBucket, config.stateKmsKeyArn);
}
