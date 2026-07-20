import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { cacheDirectory } from "./paths.ts";
import { redactSensitiveText, run, type RunOptions } from "./process.ts";

type CommandRunner = (command: string[], options?: RunOptions) => Promise<string>;

export function awsArgs(profile: string, region: string, args: string[]): string[] {
  return ["aws", "--profile", profile, "--region", region, ...args];
}

export async function awsJson<T>(profile: string, region: string, args: string[]): Promise<T> {
  const output = await run(awsArgs(profile, region, [...args, "--output", "json"]), { quiet: true });
  return JSON.parse(output || "{}") as T;
}

export async function accountId(profile: string, region: string): Promise<string> {
  const identity = await awsJson<{ Account: string }>(profile, region, ["sts", "get-caller-identity"]);
  if (!identity.Account) throw new Error("AWS did not return an account ID");
  return identity.Account;
}

export async function bootstrapStateBucket(
  profile: string,
  region: string,
  bucket: string,
  execute: CommandRunner = run,
): Promise<void> {
  let exists = true;
  try {
    await execute(awsArgs(profile, region, ["s3api", "head-bucket", "--bucket", bucket]), { quiet: true });
  } catch {
    exists = false;
  }
  if (!exists && process.env.CONTEXT_USE_DRY_RUN !== "1") {
    const create = ["s3api", "create-bucket", "--bucket", bucket];
    if (region !== "us-east-1") create.push("--create-bucket-configuration", `LocationConstraint=${region}`);
    await execute(awsArgs(profile, region, create), { quiet: true });
    await execute(awsArgs(profile, region, ["s3api", "wait", "bucket-exists", "--bucket", bucket]), { quiet: true });
  }
  await execute(awsArgs(profile, region, ["s3api", "put-public-access-block", "--bucket", bucket, "--public-access-block-configuration", "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"]), { quiet: true });
  await execute(awsArgs(profile, region, ["s3api", "put-bucket-versioning", "--bucket", bucket, "--versioning-configuration", "Status=Enabled"]), { quiet: true });
  if (!exists) {
    await execute(awsArgs(profile, region, ["s3api", "put-bucket-encryption", "--bucket", bucket, "--server-side-encryption-configuration", '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"},"BucketKeyEnabled":true}]}']), { quiet: true });
  }
}

export async function createStateKmsKey(profile: string, region: string, installationId: string): Promise<{ arn: string; id: string }> {
  const alias = `alias/context-use-${installationId}-terraform-state`;
  try {
    const existing = await awsJson<{ KeyMetadata: { Arn: string; KeyId: string } }>(profile, region, ["kms", "describe-key", "--key-id", alias]);
    if (existing.KeyMetadata?.Arn && existing.KeyMetadata?.KeyId) return { arn: existing.KeyMetadata.Arn, id: existing.KeyMetadata.KeyId };
  } catch {
    // The installation-scoped alias is absent, so a new key is required.
  }
  const created = await awsJson<{ KeyMetadata: { Arn: string; KeyId: string } }>(profile, region, [
    "kms", "create-key", "--description", `context-use ${installationId} Terraform state`,
    "--tags", `TagKey=Project,TagValue=context-use`, `TagKey=Installation,TagValue=${installationId}`,
  ]);
  const arn = created.KeyMetadata?.Arn;
  const id = created.KeyMetadata?.KeyId;
  if (!arn || !id) throw new Error("AWS did not return the Terraform-state KMS key");
  await run(awsArgs(profile, region, ["kms", "enable-key-rotation", "--key-id", arn]), { quiet: true });
  await run(awsArgs(profile, region, ["kms", "create-alias", "--alias-name", alias, "--target-key-id", arn]), { quiet: true });
  return { arn, id };
}

export async function scheduleStateKmsKeyDeletion(profile: string, region: string, installationId: string, keyArn: string): Promise<void> {
  await run(awsArgs(profile, region, ["kms", "delete-alias", "--alias-name", `alias/context-use-${installationId}-terraform-state`]), { quiet: true });
  await run(awsArgs(profile, region, ["kms", "schedule-key-deletion", "--key-id", keyArn, "--pending-window-in-days", "30"]), { quiet: true });
}

export async function configureStateBucketKms(profile: string, region: string, bucket: string, kmsKeyArn: string): Promise<void> {
  const encryptionPath = resolve(cacheDirectory, `state-encryption-${randomBytes(8).toString("hex")}.json`);
  const policyPath = resolve(cacheDirectory, `state-policy-${randomBytes(8).toString("hex")}.json`);
  const encryption = {
    Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: "aws:kms", KMSMasterKeyID: kmsKeyArn }, BucketKeyEnabled: true }],
  };
  const policy = {
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "DenyInsecureTransport", Effect: "Deny", Principal: "*", Action: "s3:*",
        Resource: [`arn:aws:s3:::${bucket}`, `arn:aws:s3:::${bucket}/*`],
        Condition: { Bool: { "aws:SecureTransport": "false" } },
      },
      {
        Sid: "DenyStateWithoutInstallationKMS", Effect: "Deny", Principal: "*", Action: "s3:PutObject",
        Resource: `arn:aws:s3:::${bucket}/*`,
        Condition: { StringNotEquals: { "s3:x-amz-server-side-encryption": "aws:kms" } },
      },
      {
        Sid: "DenyStateWithAnotherKMSKey", Effect: "Deny", Principal: "*", Action: "s3:PutObject",
        Resource: `arn:aws:s3:::${bucket}/*`,
        Condition: { StringNotEquals: { "s3:x-amz-server-side-encryption-aws-kms-key-id": kmsKeyArn } },
      },
    ],
  };
  await Bun.write(encryptionPath, JSON.stringify(encryption), { createPath: true, mode: 0o600 });
  await Bun.write(policyPath, JSON.stringify(policy), { createPath: true, mode: 0o600 });
  try {
    await run(awsArgs(profile, region, ["s3api", "put-bucket-encryption", "--bucket", bucket, "--server-side-encryption-configuration", `file://${encryptionPath}`]), { quiet: true });
    const objects = await awsJson<{ Contents?: Array<{ Key: string }> }>(profile, region, ["s3api", "list-objects-v2", "--bucket", bucket]);
    for (const object of objects.Contents ?? []) {
      const current = await awsJson<{ ServerSideEncryption?: string; SSEKMSKeyId?: string }>(profile, region, [
        "s3api", "head-object", "--bucket", bucket, "--key", object.Key,
      ]);
      if (current.ServerSideEncryption !== "aws:kms" || current.SSEKMSKeyId !== kmsKeyArn) {
        await run(awsArgs(profile, region, [
          "s3api", "copy-object", "--bucket", bucket, "--key", object.Key,
          "--copy-source", `${bucket}/${object.Key}`, "--metadata-directive", "COPY",
          "--server-side-encryption", "aws:kms", "--ssekms-key-id", kmsKeyArn,
        ]), { quiet: true });
      }
    }
    const versions = await awsJson<{ Versions?: Array<{ Key: string; VersionId: string }> }>(profile, region, ["s3api", "list-object-versions", "--bucket", bucket]);
    for (const version of versions.Versions ?? []) {
      const head = await awsJson<{ ServerSideEncryption?: string; SSEKMSKeyId?: string }>(profile, region, [
        "s3api", "head-object", "--bucket", bucket, "--key", version.Key, "--version-id", version.VersionId,
      ]);
      if (head.ServerSideEncryption !== "aws:kms" || head.SSEKMSKeyId !== kmsKeyArn) {
        await run(awsArgs(profile, region, ["s3api", "delete-object", "--bucket", bucket, "--key", version.Key, "--version-id", version.VersionId]), { quiet: true });
      }
    }
    await run(awsArgs(profile, region, ["s3api", "put-bucket-policy", "--bucket", bucket, "--policy", `file://${policyPath}`]), { quiet: true });
  } finally {
    await Bun.file(encryptionPath).delete();
    await Bun.file(policyPath).delete();
  }
}

export async function putSecureParameter(profile: string, region: string, name: string, value: string, kmsKeyId: string): Promise<void> {
  const path = resolve(cacheDirectory, `ssm-${randomBytes(8).toString("hex")}.json`);
  await Bun.write(path, JSON.stringify({ Name: name, Value: value, Type: "SecureString", KeyId: kmsKeyId, Overwrite: true }), { createPath: true, mode: 0o600 });
  try {
    await run(awsArgs(profile, region, ["ssm", "put-parameter", "--cli-input-json", `file://${path}`]), { quiet: true });
  } finally {
    await Bun.file(path).delete();
  }
}

export async function getSecureParameter(profile: string, region: string, name: string): Promise<string> {
  const result = await awsJson<{ Parameter?: { Value?: string } }>(profile, region, [
    "ssm", "get-parameter", "--name", name, "--with-decryption",
  ]);
  const value = result.Parameter?.Value;
  if (!value) throw new Error(`SSM parameter ${name} has no value`);
  return value;
}

export async function deleteParameterPath(profile: string, region: string, prefix: string): Promise<void> {
  const result = await awsJson<{ Parameters?: Array<{ Name: string }> }>(profile, region, [
    "ssm", "get-parameters-by-path", "--path", prefix, "--recursive",
  ]);
  const names = (result.Parameters ?? []).map((parameter) => parameter.Name);
  for (let index = 0; index < names.length; index += 10) {
    await run(awsArgs(profile, region, ["ssm", "delete-parameters", "--names", ...names.slice(index, index + 10)]), { quiet: true });
  }
}

export async function emptyVersionedBucket(profile: string, region: string, bucket: string): Promise<void> {
  const versions = await awsJson<{
    Versions?: Array<{ Key: string; VersionId: string }>;
    DeleteMarkers?: Array<{ Key: string; VersionId: string }>;
  }>(profile, region, ["s3api", "list-object-versions", "--bucket", bucket]);
  const objects = [...(versions.Versions ?? []), ...(versions.DeleteMarkers ?? [])]
    .map(({ Key, VersionId }) => ({ Key, VersionId }));
  for (let index = 0; index < objects.length; index += 1_000) {
    const path = resolve(cacheDirectory, `s3-delete-${randomBytes(8).toString("hex")}.json`);
    await Bun.write(path, JSON.stringify({ Objects: objects.slice(index, index + 1_000), Quiet: true }), { createPath: true, mode: 0o600 });
    try {
      await run(awsArgs(profile, region, ["s3api", "delete-objects", "--bucket", bucket, "--delete", `file://${path}`]), { quiet: true });
    } finally {
      await Bun.file(path).delete();
    }
  }
}

export async function deleteStateBucket(profile: string, region: string, bucket: string): Promise<void> {
  await emptyVersionedBucket(profile, region, bucket);
  await run(awsArgs(profile, region, ["s3api", "delete-bucket", "--bucket", bucket]), { quiet: true });
}

export async function listBackups(profile: string, region: string, bucket: string): Promise<Array<{ key: string; modified: string; size: number }>> {
  const result = await awsJson<{ Contents?: Array<{ Key: string; LastModified: string; Size: number }> }>(profile, region, [
    "s3api", "list-objects-v2", "--bucket", bucket, "--prefix", "postgres/",
  ]);
  return (result.Contents ?? [])
    .filter((entry) => /^postgres\/[0-9TZ-]+\.sql\.gz$/.test(entry.Key))
    .map((entry) => ({ key: entry.Key, modified: entry.LastModified, size: entry.Size }))
    .sort((a, b) => b.modified.localeCompare(a.modified));
}

export function generateSecret(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export async function waitForSsm(profile: string, region: string, instanceId: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = await awsJson<{ InstanceInformationList?: Array<{ PingStatus: string }> }>(profile, region, [
      "ssm", "describe-instance-information", "--filters", `Key=InstanceIds,Values=${instanceId}`,
    ]);
    if (result.InstanceInformationList?.[0]?.PingStatus === "Online") return;
    await Bun.sleep(5_000);
  }
  throw new Error("EC2 instance did not become available through Systems Manager");
}

export type SsmCommandInvocation = {
  Status: string;
  StandardOutputContent?: string;
  StandardErrorContent?: string;
};

const pendingSsmStatuses = new Set(["Pending", "InProgress", "Delayed", "Cancelling"]);

export async function waitForSsmInvocation(
  readInvocation: () => Promise<SsmCommandInvocation>,
  pause: () => Promise<void> = () => Bun.sleep(5_000),
  maxAttempts = 720,
): Promise<SsmCommandInvocation> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const invocation = await readInvocation();
      if (!pendingSsmStatuses.has(invocation.Status)) return invocation;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (!detail.includes("InvocationDoesNotExist")) throw error;
    }
    if (attempt < maxAttempts - 1) await pause();
  }
  throw new Error("Remote command did not complete within one hour");
}

export async function sendSsmCommands(profile: string, region: string, instanceId: string, commands: string[]): Promise<string> {
  const path = resolve(cacheDirectory, `ssm-command-${randomBytes(8).toString("hex")}.json`);
  await Bun.write(path, JSON.stringify({ DocumentName: "AWS-RunShellScript", InstanceIds: [instanceId], Parameters: { commands: strictSsmCommands(commands) } }), { createPath: true, mode: 0o600 });
  try {
    const result = await awsJson<{ Command: { CommandId: string } }>(profile, region, ["ssm", "send-command", "--cli-input-json", `file://${path}`]);
    const commandId = result.Command.CommandId;
    const invocation = await waitForSsmInvocation(() => awsJson<SsmCommandInvocation>(profile, region, [
      "ssm", "get-command-invocation", "--command-id", commandId, "--instance-id", instanceId,
    ]));
    if (invocation.Status !== "Success") {
      const detail = redactSensitiveText(invocation.StandardErrorContent?.trim() ?? "") || `status ${invocation.Status}`;
      throw new Error(`Remote command failed: ${detail}`);
    }
    return invocation.StandardOutputContent ?? "";
  } finally {
    await Bun.file(path).delete();
  }
}

export function strictSsmCommands(commands: string[]): string[] {
  return commands[0] === "set -euo pipefail" ? commands : ["set -euo pipefail", ...commands];
}
