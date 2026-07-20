import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { bootstrapStateBucket, strictSsmCommands, waitForSsmInvocation } from "./aws.ts";
import {
  computeBootstrapCommands,
  deploymentCommands,
  dnsMismatches,
  healthMatchesVersion,
} from "./deploy.ts";
import {
  DATA_VOLUME_INITIALIZATION_TAG,
  dataVolumeInitializationAuthorized,
  markDataVolumeInitialized,
  retainedDataVolumeExists,
} from "./data-volume.ts";
import { restoreCommands } from "./commands/restore.ts";
import { normalizeDeploymentConfig } from "./paths.ts";
import { redactSensitiveText } from "./process.ts";
import { backendArgs, initializeTerraformBackend, terraformEnvironment } from "./terraform.ts";
import type { ComputeOutputs, DataOutputs, DeploymentConfig, ReleaseManifest } from "./types.ts";

function deploymentConfig(overrides: Partial<DeploymentConfig> = {}): DeploymentConfig {
  return {
    schemaVersion: 2,
    releaseVersion: "v0.1.2",
    environment: "production",
    installationId: "abcdef123456",
    awsProfile: "default",
    awsRegion: "eu-west-2",
    availabilityZone: "eu-west-2a",
    accountId: "123456789012",
    hostname: "context.example.com",
    assetHostname: "assets.context.example.com",
    dnsMode: "manual",
    route53ZoneId: "",
    ownerEmail: "owner@example.com",
    stateBucket: "context-use-state",
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
  expect(backendArgs(config, "installation/production/data.tfstate").some((argument) => argument.includes("kms_key_id="))).toBe(false);
});

test("a newly created state bucket is awaited before it is configured", async () => {
  const commands: string[][] = [];
  await bootstrapStateBucket("default", "eu-west-2", "context-use-state", async (command) => {
    commands.push(command);
    if (command.includes("head-bucket")) throw new Error("Not Found");
    return "";
  });

  const operation = (command: string[]) => command.slice(5, 8).join(" ");
  expect(commands.map(operation)).toEqual([
    "s3api head-bucket --bucket",
    "s3api create-bucket --bucket",
    "s3api wait bucket-exists",
    "s3api put-public-access-block --bucket",
    "s3api put-bucket-versioning --bucket",
    "s3api put-bucket-policy --bucket",
    "s3api put-bucket-encryption --bucket",
    "s3api list-objects-v2 --bucket",
  ]);
});

test("state bootstrap fails closed on access errors and rewrites only non-SSE-S3 current objects", async () => {
  await expect(bootstrapStateBucket("default", "eu-west-2", "context-use-state", async (command) => {
    if (command.includes("head-bucket")) throw new Error("AccessDenied");
    return "";
  })).rejects.toThrow("AccessDenied");

  const commands: string[][] = [];
  await bootstrapStateBucket("default", "eu-west-2", "context-use-state", async (command) => {
    commands.push(command);
    if (command.includes("list-objects-v2")) {
      return JSON.stringify({ Contents: [{ Key: "install/data.tfstate" }, { Key: "install/compute.tfstate" }] });
    }
    if (command.includes("head-object")) {
      return JSON.stringify({ ServerSideEncryption: command.some((part) => part.endsWith("data.tfstate")) ? "aws:kms" : "AES256" });
    }
    return "";
  });
  const copies = commands.filter((command) => command.includes("copy-object"));
  expect(copies).toHaveLength(1);
  expect(copies[0]).toContain("install/data.tfstate");
  expect(copies[0]).toContain("AES256");
});

test("Terraform backend initialization retries a newly created bucket propagation error", async () => {
  const errors = [
    new Error('terraform failed (1): Error: error loading state: S3 bucket "context-use-state" does not exist.'),
    new Error("terraform failed (1): operation error S3: ListObjectsV2, api error NoSuchBucket"),
  ];
  let attempts = 0;
  let pauses = 0;
  await initializeTerraformBackend("/tmp/data", deploymentConfig(), "installation/production/data.tfstate", {}, async () => {
    attempts += 1;
    const error = errors.shift();
    if (error) throw error;
    return "";
  }, async () => { pauses += 1; }, 3);

  expect(attempts).toBe(3);
  expect(pauses).toBe(2);
});

test("Terraform backend initialization does not retry non-propagation failures", async () => {
  let attempts = 0;
  await expect(initializeTerraformBackend("/tmp/data", deploymentConfig(), "installation/production/data.tfstate", {}, async () => {
    attempts += 1;
    throw new Error("terraform failed (1): AccessDenied");
  }, async () => {}, 3)).rejects.toThrow("AccessDenied");

  expect(attempts).toBe(1);
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

test("deployment diagnoses cloud-init separately and always removes its temporary script", () => {
  expect(strictSsmCommands(computeBootstrapCommands())).toEqual([
    "set -euo pipefail",
    "if cloud-init status --wait; then exit 0; fi",
    "cloud-init status --long || true",
    "tail -n 100 /var/log/cloud-init-output.log >&2 || true",
    "exit 1",
  ]);

  const commands = strictSsmCommands(deploymentCommands(deploymentConfig(), manifest, "#!/bin/sh\nexit 0\n"));

  expect(commands.slice(0, 4)).toEqual([
    "set -euo pipefail",
    "trap 'rm -f /tmp/context-use-deploy.sh' EXIT",
    expect.stringContaining("base64 -d"),
    "chmod 0700 /tmp/context-use-deploy.sh",
  ]);
  expect(commands.at(-1)).toContain("arn:aws:iam::123456789012:role/context-use-abcdef123456-production-storage");
  expect(commands.at(-1)).toContain("arn:aws:iam::123456789012:role/context-use-abcdef123456-production-backup");

  const recovery = deploymentCommands(
    deploymentConfig(),
    manifest,
    "#!/bin/sh\nexit 0\n",
    "postgres/2026-07-20T10-20-30-123456789Z.sql.gz",
  );
  expect(recovery.at(-1)).toContain("CONTEXT_USE_RECOVERY_BACKUP_KEY='postgres/2026-07-20T10-20-30-123456789Z.sql.gz'");
  expect(() => deploymentCommands(deploymentConfig(), manifest, "", "../other.sql.gz"))
    .toThrow("Invalid recovery backup key");
});

function dataReadyConfig(overrides: Partial<DeploymentConfig> = {}): DeploymentConfig {
  return deploymentConfig(overrides);
}

const dataOutputs: DataOutputs = {
  kms_key_arn: "arn:aws:kms:eu-west-2:123456789012:key/data",
  kms_key_id: "data-key",
  data_volume_id: "vol-0123456789abcdef0",
  asset_bucket: "assets",
  backup_bucket: "backups",
};

const computeOutputs: ComputeOutputs = {
  instance_id: "i-test",
  public_ip: "192.0.2.10",
  app_url: "https://context.example.com",
  asset_url: "https://assets.context.example.com",
  cloudwatch_log_group: "test",
};

function describedVolume(initialization: string | null = "pending") {
  return {
    VolumeId: "vol-0123456789abcdef0",
    AvailabilityZone: "eu-west-2a",
    Encrypted: true,
    KmsKeyId: "arn:aws:kms:eu-west-2:123456789012:key/data",
    SnapshotId: "",
    Tags: [
      { Key: "Project", Value: "context-use" },
      { Key: "Environment", Value: "production" },
      { Key: "Installation", Value: "abcdef123456" },
      { Key: "ManagedBy", Value: "context-use-cli" },
      ...(initialization === null ? [] : [{ Key: DATA_VOLUME_INITIALIZATION_TAG, Value: initialization }]),
    ],
  };
}

test("only a Terraform-tagged fresh data volume receives initialization authorization", async () => {
  const config = dataReadyConfig();
  expect(await dataVolumeInitializationAuthorized(config, dataOutputs, true, async () => describedVolume())).toBe(true);
  expect(await dataVolumeInitializationAuthorized(config, dataOutputs, true, async () => describedVolume("complete"))).toBe(false);
  expect(await dataVolumeInitializationAuthorized(config, dataOutputs, true, async () => describedVolume(null))).toBe(false);
  expect(await dataVolumeInitializationAuthorized(config, dataOutputs, false, async () => describedVolume())).toBe(false);

  await expect(dataVolumeInitializationAuthorized(config, dataOutputs, true, async () => ({
    ...describedVolume(),
    SnapshotId: "snap-existing-data",
  }))).rejects.toThrow("identity or provenance is unexpected");
  await expect(dataVolumeInitializationAuthorized(config, dataOutputs, true, async () => ({
    ...describedVolume(),
    KmsKeyId: "arn:aws:kms:eu-west-2:123456789012:key/other",
  }))).rejects.toThrow("identity or provenance is unexpected");
  await expect(dataVolumeInitializationAuthorized(config, dataOutputs, true, async () => ({
    ...describedVolume(),
    Tags: describedVolume().Tags.map((tag) => tag.Key === "Installation" ? { ...tag, Value: "other-installation" } : tag),
  }))).rejects.toThrow("identity or provenance is unexpected");
});

test("lost-volume detection distinguishes an explicit AWS not-found response from other failures", async () => {
  expect(await retainedDataVolumeExists(dataReadyConfig(), dataOutputs, async () => describedVolume())).toBe(true);
  expect(await retainedDataVolumeExists(dataReadyConfig(), dataOutputs, async () => {
    throw new Error("InvalidVolume.NotFound");
  })).toBe(false);
  await expect(retainedDataVolumeExists(dataReadyConfig(), dataOutputs, async () => {
    throw new Error("AccessDenied");
  })).rejects.toThrow("AccessDenied");
});

test("successful bootstrap consumes the durable AWS initialization authorization", async () => {
  const config = dataReadyConfig();
  let command: string[] = [];
  await markDataVolumeInitialized(config, dataOutputs, async () => describedVolume(), async (observed) => {
    command = observed;
    return "";
  });
  expect(command).toContain("create-tags");
  expect(command).toContain(`Key=${DATA_VOLUME_INITIALIZATION_TAG},Value=complete`);

  let called = false;
  await markDataVolumeInitialized(config, dataOutputs, async () => describedVolume("complete"), async () => {
    called = true;
    return "";
  });
  expect(called).toBe(false);
});

async function dataVolumePolicyAction(filesystem: string, authorized: boolean, recorded: boolean): Promise<string> {
  const policy = fileURLToPath(new URL("../../../infra/compute/data-volume-policy.sh", import.meta.url));
  const process = Bun.spawn([
    "bash", "-c",
    'source "$1"; context_use_data_volume_action "$2" "$3" "$4"',
    "context-use-volume-policy",
    policy,
    filesystem,
    String(authorized),
    String(recorded),
  ], { stdout: "pipe", stderr: "pipe" });
  const output = await new Response(process.stdout).text();
  const error = await new Response(process.stderr).text();
  const status = await process.exited;
  if (status !== 0) throw new Error(error || `Volume policy exited ${status}`);
  return output.trim();
}

test("data-volume policy initializes only a first-install volume and fails closed otherwise", async () => {
  expect(await dataVolumePolicyAction("", true, false)).toBe("initialize");
  expect(await dataVolumePolicyAction("xfs", false, false)).toBe("use-existing");
  expect(await dataVolumePolicyAction("", false, false)).toBe("reject-uninitialized");
  expect(await dataVolumePolicyAction("", true, true)).toBe("reject-reinitialization");
  expect(await dataVolumePolicyAction("ext4", true, false)).toBe("reject-filesystem");
});

test("restore verifies the backup, keeps traffic down on failure, migrates, and restarts on success", () => {
  const script = restoreCommands("backup-bucket", "postgres/2026-07-17T10-39-47Z.sql.gz").join("\n");

  expect(script).toContain(". /data/context-use/secrets/runtime.env");
  expect(script).toContain("export PGPASSWORD=\"$POSTGRES_PASSWORD\"");
  expect(script).toContain("exec -T -e PGPASSWORD postgres psql");
  expect(script).toContain("--single-transaction");
  expect(script).toContain("backup fetch 'postgres/2026-07-17T10-39-47Z.sql.gz'");
  expect(script).not.toContain("aws s3 cp");
  expect(script).toContain("stop caddy dashboard-edge auth-edge private-mcp-edge");
  expect(script).toContain("trap restore_failed EXIT");
  expect(script).toContain("up -d postgres aws-credential-broker backup");
  expect(script).toContain("CREATE ROLE context_use_public_mcp NOLOGIN");
  expect(script.match(/DROP ROLE IF EXISTS context_use_public_mcp/g)?.length).toBe(3);
  expect(script).toContain("--profile migration run --rm migrate");
  expect(script.indexOf("CREATE ROLE context_use_public_mcp NOLOGIN")).toBeLessThan(script.indexOf("backup fetch"));
  expect(script.lastIndexOf("DROP ROLE IF EXISTS context_use_public_mcp")).toBeGreaterThan(script.indexOf("--profile migration run --rm migrate"));
  expect(script).toContain("up -d --remove-orphans");
  expect(script).not.toContain("POSTGRES_PASSWORD=");
});

test("deployment health must report the requested release version", () => {
  expect(healthMatchesVersion({ status: "ok", version: "0.1.4" }, "v0.1.4")).toBe(true);
  expect(healthMatchesVersion({ status: "ok", version: "0.1.3" }, "v0.1.4")).toBe(false);
  expect(healthMatchesVersion({ status: "ok" }, "v0.1.4")).toBe(false);
});

test("legacy configs retain durable state coordinates without derived lifecycle fields", () => {
  const {
    schemaVersion: _schemaVersion,
    legacyStateKmsKeyArn: _legacyStateKmsKeyArn,
    ...legacy
  } = deploymentConfig();
  expect(normalizeDeploymentConfig({
    ...legacy,
    schemaVersion: 1,
    stateKmsKeyArn: "arn:aws:kms:eu-west-2:123456789012:key/state",
    phase: "deployed",
    parametersReady: true,
  })).toMatchObject({
    hostname: "context.example.com",
    legacyStateKmsKeyArn: "arn:aws:kms:eu-west-2:123456789012:key/state",
  });
});

test("manual dashboard and asset DNS must resolve to the deployment IP", async () => {
  const config = deploymentConfig();
  expect(await dnsMismatches(config, computeOutputs, async () => ["192.0.2.10"])).toEqual([]);
  expect(await dnsMismatches(config, computeOutputs, async (hostname) => hostname.startsWith("assets.") ? ["192.0.2.11"] : ["192.0.2.10"]))
    .toEqual(["assets.context.example.com"]);
  expect(await dnsMismatches(config, computeOutputs, async () => { throw new Error("NXDOMAIN"); }))
    .toEqual(["context.example.com", "assets.context.example.com"]);
});

test("instance bootstrap, proxy limits, and TLS configuration contain the live-deployment fixes", async () => {
  const [userData, deployScript, caddy, compute, update, setup, resume, data, deployCompose, backupScript, cliUpdate] = await Promise.all([
    Bun.file(new URL("../../../infra/compute/user-data.sh.tftpl", import.meta.url)).text(),
    Bun.file(new URL("../../../deploy/deploy.sh", import.meta.url)).text(),
    Bun.file(new URL("../../../deploy/Caddyfile", import.meta.url)).text(),
    Bun.file(new URL("../../../infra/compute/main.tf", import.meta.url)).text(),
    Bun.file(new URL("./commands/update.ts", import.meta.url)).text(),
    Bun.file(new URL("./setup.ts", import.meta.url)).text(),
    Bun.file(new URL("./commands/resume.ts", import.meta.url)).text(),
    Bun.file(new URL("../../../infra/data/main.tf", import.meta.url)).text(),
    Bun.file(new URL("../../../deploy/docker-compose.yml", import.meta.url)).text(),
    Bun.file(new URL("../../../deploy/backup/backup.sh", import.meta.url)).text(),
    Bun.file(new URL("./cli-update.ts", import.meta.url)).text(),
  ]);

  expect(userData.indexOf("install -d -m 0755 /usr/local/lib/docker/cli-plugins")).toBeLessThan(userData.indexOf("docker-compose-linux-"));
  expect(userData).toContain("context_use_data_volume_action");
  expect(userData).toContain("Refusing to initialize the retained data volume without explicit first-install authorization");
  expect(userData).toContain("Refusing to reinitialize the retained data volume after one-time initialization was consumed");
  expect(userData).toContain("Refusing to adopt an unmarked retained data volume");
  expect(userData).toContain("Data-volume initialization record belongs to another volume");
  expect(userData).not.toContain("cmp -n");
  expect(userData).not.toContain("/dev/zero");
  expect(userData).not.toContain("/dev/xvdf");
  expect(userData).not.toContain("if ! blkid");
  expect(deployScript).toContain("mountpoint -q /data");
  expect(deployScript).toContain("/data/context-use/.volume-id");
  expect(deployScript).not.toContain("AUTH_EDGE_TOKEN");
  expect(deployScript).not.toContain("PUBLIC_MCP");
  expect(deployScript).toContain("CREATE ROLE context_use_public_mcp NOLOGIN");
  expect(deployScript).toContain("DROP ROLE IF EXISTS context_use_public_mcp");
  expect(deployScript.indexOf("CONTEXT_USE_RECOVERY_BACKUP_KEY")).toBeLessThan(deployScript.indexOf("up -d --remove-orphans"));
  expect(deployScript).toContain("psql --single-transaction -v ON_ERROR_STOP=1");
  expect(deployScript.indexOf("up -d --remove-orphans")).toBeLessThan(deployScript.indexOf("up -d --force-recreate --no-deps caddy"));
  expect(caddy).not.toContain("email off");
  expect(caddy).toContain("protocols h1 h2");
  expect(caddy).not.toContain("protocols h1 h2 h3");
  expect(deployCompose).not.toContain('"443:443/udp"');
  expect(compute).not.toContain('description = "HTTP3"');
  expect(caddy).toContain("handle /api/dashboard/assets/*/content");
  expect(caddy).toContain("handle /api/mcp/assets/*/content");
  expect(caddy).toContain("handle /content.css");
  expect(caddy).not.toContain("handle /api/dashboard/publications/confirm");
  expect(caddy).not.toContain("handle /api/dashboard/session");
  expect(caddy).toContain("handle /api/auth/*");
  expect(caddy).toContain("reverse_proxy auth-edge:3006");
  expect(caddy).toContain("reverse_proxy dashboard-edge:3007");
  expect(caddy).toContain("reverse_proxy private-mcp-edge:3008");
  expect(caddy).not.toContain("reverse_proxy auth:3002");
  expect(caddy).not.toContain("reverse_proxy app:3000");
  expect(caddy).not.toContain("reverse_proxy private-mcp:3003");
  expect(caddy).not.toContain("handle /api/public/assets/*/content");
  expect(caddy).not.toContain("handle /public/mcp");
  expect(caddy).not.toContain("PUBLIC_MCP");
  expect(caddy).not.toContain("public-mcp");
  const assetSite = caddy.slice(caddy.indexOf("{$ASSET_HOSTNAME}"));
  expect(assetSite).toContain("handle /a/*");
  expect(assetSite).not.toContain("handle /p/*");
  expect(assetSite).toContain('respond "Not found" 404');
  expect(assetSite).not.toContain("/api/dashboard");
  expect(assetSite).not.toContain("/api/mcp");
  const lockedService = deployCompose.slice(
    deployCompose.indexOf("x-locked-service:"),
    deployCompose.indexOf("x-logging:"),
  );
  const parsedCompose = Bun.YAML.parse(deployCompose) as {
    "x-locked-service": { tmpfs: string[] };
    services: Record<string, { tmpfs?: string[] }>;
  };
  expect(parsedCompose["x-locked-service"].tmpfs).toEqual(["/tmp:size=32m,mode=1777"]);
  expect(parsedCompose.services["aws-credential-broker"]?.tmpfs).toEqual(["/tmp:size=8m,mode=1777"]);
  expect(parsedCompose.services.storage?.tmpfs).toEqual(["/tmp:size=32m,mode=1777"]);
  expect(parsedCompose.services["public-mcp"]).toBeUndefined();
  expect(lockedService).toContain("read_only: true");
  expect(lockedService).toContain("cap_drop: [ALL]");
  expect(deployCompose).not.toContain("PUBLIC_MCP");
  expect(deployCompose).not.toContain("public_mcp_data");
  expect(deployCompose).not.toContain("context_use_public_mcp:");
  const appService = deployCompose.slice(
    deployCompose.indexOf("\n  app:\n"),
    deployCompose.indexOf("\n  auth-edge:\n"),
  );
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
  expect(appService).toContain("networks: [dashboard_data, dashboard_edge_internal, auth_dashboard_internal, confirmation_internal]");

  const dashboardEdgeService = deployCompose.slice(
    deployCompose.indexOf("\n  dashboard-edge:\n"),
    deployCompose.indexOf("\n  app:\n"),
  );
  expect(dashboardEdgeService).toContain("SERVICE_MODE: dashboard-edge");
  expect(dashboardEdgeService).toContain("DASHBOARD_AUTHORITY_URL: http://app:3000");
  expect(dashboardEdgeService).toContain("networks: [dashboard_web, dashboard_edge_internal]");
  expect(dashboardEdgeService).not.toContain("DATABASE_URL");
  expect(dashboardEdgeService).not.toContain("TOKEN");
  expect(dashboardEdgeService).not.toContain("SECRET");

  const authEdgeService = deployCompose.slice(
    deployCompose.indexOf("\n  auth-edge:\n"),
    deployCompose.indexOf("\n  auth:\n"),
  );
  expect(authEdgeService).toContain("SERVICE_MODE: auth-edge");
  expect(authEdgeService).toContain("AUTH_AUTHORITY_URL: http://auth:3002");
  expect(authEdgeService).toContain("networks: [auth_web, auth_edge_internal]");
  expect(authEdgeService).not.toContain("TOKEN");
  expect(authEdgeService).not.toContain("SECRET");
  expect(authEdgeService).not.toContain("AUTH_DATABASE_URL");
  expect(authEdgeService).not.toContain("BETTER_AUTH_SECRET");
  expect(authEdgeService).not.toContain("AUTH_DASHBOARD_TOKEN");
  expect(authEdgeService).not.toContain("AUTH_MCP_TOKEN");
  expect(authEdgeService).not.toContain("CONFIRMATION_GATEWAY_TOKEN");

  const authService = deployCompose.slice(
    deployCompose.indexOf("\n  auth:\n"),
    deployCompose.indexOf("\n  private-mcp-edge:\n"),
  );
  expect(authService).toContain("AUTH_DATABASE_URL: postgres://context_use_auth");
  expect(authService).toContain("BETTER_AUTH_SECRET");
  expect(authService).not.toContain("AUTH_EDGE_TOKEN");
  expect(authService).toContain("CONFIRMATION_GATEWAY_TOKEN");
  expect(authService).toContain("AUTH_DASHBOARD_TOKEN");
  expect(authService).toContain("AUTH_MCP_TOKEN");
  expect(authService).not.toContain("CONFIRMATION_DASHBOARD_TOKEN");
  expect(authService).toContain("CONFIRMATION_INTERNAL_URL: http://confirmation:3004");
  expect(authService).not.toContain("DATABASE_URL: postgres://context_use_dashboard");
  expect(authService).not.toContain("STORAGE_");
  expect(authService).not.toContain("AWS_REGION:");
  expect(authService).toContain("networks: [auth_data, auth_edge_internal, auth_dashboard_internal, auth_mcp_internal, auth_confirmation_internal]");

  const privateMcpEdgeService = deployCompose.slice(
    deployCompose.indexOf("\n  private-mcp-edge:\n"),
    deployCompose.indexOf("\n  private-mcp:\n"),
  );
  expect(privateMcpEdgeService).toContain("SERVICE_MODE: mcp-edge");
  expect(privateMcpEdgeService).toContain("MCP_AUTHORITY_URL: http://private-mcp:3003");
  expect(privateMcpEdgeService).toContain("networks: [mcp_web, mcp_edge_internal]");
  expect(privateMcpEdgeService).not.toContain("DATABASE_URL");
  expect(privateMcpEdgeService).not.toContain("TOKEN");
  expect(privateMcpEdgeService).not.toContain("SECRET");

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
  expect(privateMcpService).toContain("networks: [mcp_data, mcp_edge_internal, auth_mcp_internal]");

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

  const storageSocketInitService = deployCompose.slice(
    deployCompose.indexOf("\n  storage-socket-init:\n"),
    deployCompose.indexOf("\n  aws-credential-broker:\n"),
  );
  expect(storageSocketInitService).toContain("cap_add: [CHOWN]");
  expect(storageSocketInitService).not.toContain("FOWNER");
  expect(storageSocketInitService.indexOf("chown root:root")).toBeLessThan(storageSocketInitService.indexOf("chmod 0700"));
  expect(storageSocketInitService.indexOf("chmod 0700")).toBeLessThan(storageSocketInitService.indexOf("chown bun:bun"));

  const storageService = deployCompose.slice(
    deployCompose.indexOf("\n  storage:\n"),
    deployCompose.indexOf("\n  caddy:\n"),
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
  expect(backupService).toContain("SCHEMA_VERSION: 002_remove_public_mcp.sql");
  expect(backupService).not.toContain("RETENTION_DAYS");
  expect(backupScript).toContain("context-use-postgres-v1");
  expect(backupScript).toContain("sha256sum -c");
  expect(backupScript).toContain("gzip -t");
  expect(backupScript.indexOf('aws s3 cp "${metadata}"')).toBeLessThan(backupScript.indexOf('aws s3 cp "${file}"'));
  expect(backupScript).not.toContain("delete-object");
  expect(deployCompose).toContain("storage-socket-init: { condition: service_completed_successfully }");
  expect(deployCompose).toContain("storage: { condition: service_healthy }");
  expect(caddy).toContain("max_size 5GB");
  expect(caddy).toContain("max_size 3MB");
  expect(compute).toContain("s3:AbortMultipartUpload");
  expect(compute).toContain("s3:GetEncryptionConfiguration");
  expect(compute).toContain("s3:GetBucketPublicAccessBlock");
  expect(compute).toContain('resource "aws_iam_role" "storage"');
  expect(compute).toContain('resource "aws_iam_role" "backup"');
  const backupPolicy = compute.slice(
    compute.indexOf('resource "aws_iam_role_policy" "backup"'),
    compute.indexOf('resource "aws_iam_role_policy" "data"'),
  );
  expect(backupPolicy).toContain("s3:GetObject");
  expect(backupPolicy).toContain("s3:PutObject");
  expect(backupPolicy).toContain("s3:AbortMultipartUpload");
  expect(backupPolicy).not.toContain("s3:DeleteObject");
  expect(backupPolicy).not.toContain("s3:ListBucket");
  expect(backupPolicy).not.toContain("s3:GetObjectVersion");
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
  expect(compute).not.toContain("public_mcp");
  expect(compute).toContain('data_volume_policy     = file("${path.module}/data-volume-policy.sh")');
  expect(update.indexOf("installCliRelease")).toBeLessThan(update.indexOf("readConfig"));
  expect(update.indexOf("currentComputeOutputs")).toBeLessThan(update.indexOf("run --rm backup once"));
  expect(update.indexOf("retainedDataVolumeExists(config")).toBeLessThan(update.indexOf("await applyData"));
  expect(update.match(/await saveConfig\(config\)/g)?.length).toBe(1);
  expect(update).not.toContain("fallback");
  expect(cliUpdate).not.toContain('"--version"');
  expect(setup.indexOf("await prepareCompute(config, data, compute)")).toBeLessThan(setup.indexOf("await ensureRuntimeParameters(config, data, compute)"));
  expect(setup.indexOf("await prepareCompute(config, data, compute)")).toBeLessThan(setup.indexOf("await pauseForManualDns(config, compute)"));
  expect(resume.indexOf("await prepareCompute(config, data, compute)")).toBeLessThan(resume.indexOf("await ensureRuntimeParameters(config, data, compute)"));
  expect(resume.indexOf("await prepareCompute(config, data, compute)")).toBeLessThan(resume.indexOf("await pauseForManualDns(config, compute)"));
  expect(resume.indexOf("retainedDataVolumeExists(config")).toBeLessThan(resume.indexOf("await applyData"));
  expect(data).toContain('ContextUseInitialization = "pending"');
  expect(data).toContain('ignore_changes = [tags["ContextUseInitialization"]]');
  expect(data).not.toContain("aws_s3_bucket_cors_configuration");
});
