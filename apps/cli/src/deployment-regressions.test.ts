import { expect, test } from "bun:test";
import { strictSsmCommands } from "./aws.ts";
import { deploymentCommands, remoteSecurityCommands } from "./deploy.ts";
import { redactSensitiveText } from "./process.ts";
import { shouldPauseForManualDns } from "./setup.ts";
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

test("deployment waits for cloud-init and always removes its temporary script", () => {
  const commands = strictSsmCommands(deploymentCommands(deploymentConfig(), manifest, "#!/bin/sh\nexit 0\n"));

  expect(commands.slice(0, 4)).toEqual([
    "set -euo pipefail",
    "trap 'rm -f /tmp/context-use-deploy.sh' EXIT",
    "cloud-init status --wait",
    expect.stringContaining("base64 -d"),
  ]);
});

test("remote verification avoids shell-quoting SQL and passes the database password through the environment", () => {
  const commands = remoteSecurityCommands();
  const script = commands.join("\n");

  expect(script).toContain("base64 -d");
  expect(script).toContain("export PGPASSWORD=\"$POSTGRES_PASSWORD\"");
  expect(script).toContain("exec -T -e PGPASSWORD postgres psql");
  expect(script).not.toContain("confirm_publication_intent");
  expect(script).not.toContain("sh -c");
});

test("an interrupted manual-DNS setup pauses once before deployment", () => {
  expect(shouldPauseForManualDns(deploymentConfig({ phase: "new" }))).toBe(true);
  expect(shouldPauseForManualDns(deploymentConfig({ phase: "compute_ready" }))).toBe(true);
  expect(shouldPauseForManualDns(deploymentConfig({ phase: "awaiting_dns" }))).toBe(false);
  expect(shouldPauseForManualDns(deploymentConfig({ phase: "deployed" }))).toBe(false);
  expect(shouldPauseForManualDns(deploymentConfig({ phase: "compute_ready", dnsMode: "route53" }))).toBe(false);
});

test("instance bootstrap and TLS configuration contain the live-deployment fixes", async () => {
  const [userData, caddy, compute] = await Promise.all([
    Bun.file(new URL("../../../infra/compute/user-data.sh.tftpl", import.meta.url)).text(),
    Bun.file(new URL("../../../deploy/Caddyfile", import.meta.url)).text(),
    Bun.file(new URL("../../../infra/compute/main.tf", import.meta.url)).text(),
  ]);

  expect(userData.indexOf("install -d -m 0755 /usr/local/lib/docker/cli-plugins")).toBeLessThan(userData.indexOf("docker-compose-linux-"));
  expect(caddy).not.toContain("email off");
  expect(compute).toContain("s3:GetEncryptionConfiguration");
  expect(compute).toContain("s3:GetBucketPublicAccessBlock");
});
