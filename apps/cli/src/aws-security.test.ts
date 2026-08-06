import { expect, test } from "bun:test";
import { chmod, mkdtemp, rm, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { cleanupStaleSsmJsonFiles, putSecureParameter, waitForSsmInvocation } from "./aws.ts";

test("SecureString writes stream values without placing them in argv or a local file", async () => {
  const secret = "github-oauth-client-secret";
  const calls: Array<{ command: string[]; options: { quiet?: boolean; stdin?: string } }> = [];
  await putSecureParameter(
    "owner",
    "eu-west-2",
    "/context-use/example/prod/request",
    secret,
    "arn:aws:kms:eu-west-2:123456789012:key/example",
    async (command, options = {}) => {
      calls.push({ command, options });
      return "";
    },
  );

  expect(calls).toHaveLength(1);
  expect(calls[0]?.command).toContain("file:///dev/stdin");
  expect(calls[0]?.command).not.toContain(secret);
  expect(calls[0]?.command).not.toContain("--cli-input-json");
  expect(calls[0]?.options).toMatchObject({ quiet: true, stdin: secret });
});

test("local SSM cleanup removes only exact stale mode-0600 JSON artifacts", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "context-use-ssm-test-"));
  const now = Date.parse("2026-08-05T12:00:00Z");
  const oldTime = new Date(now - 2 * 60 * 60 * 1_000);
  const recentTime = new Date(now - 30 * 60 * 1_000);
  const stale = resolve(directory, `ssm-${"a".repeat(16)}.json`);
  const staleCommand = resolve(directory, `ssm-command-${"b".repeat(16)}.json`);
  const recent = resolve(directory, `ssm-${"c".repeat(16)}.json`);
  const unsafeMode = resolve(directory, `ssm-${"d".repeat(16)}.json`);
  const unrelated = resolve(directory, "ssm-user-file.json");
  try {
    for (const path of [stale, staleCommand, recent, unsafeMode, unrelated]) {
      await Bun.write(path, "{}", { mode: 0o600 });
      await chmod(path, 0o600);
    }
    await chmod(unsafeMode, 0o644);
    for (const path of [stale, staleCommand, unsafeMode, unrelated]) await utimes(path, oldTime, oldTime);
    await utimes(recent, recentTime, recentTime);

    expect((await cleanupStaleSsmJsonFiles(directory, now)).sort()).toEqual([stale, staleCommand].sort());
    expect(await Bun.file(stale).exists()).toBe(false);
    expect(await Bun.file(staleCommand).exists()).toBe(false);
    expect(await Bun.file(recent).exists()).toBe(true);
    expect((await stat(unsafeMode)).mode & 0o777).toBe(0o644);
    expect(await Bun.file(unrelated).exists()).toBe(true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("SSM polling observes cancellation before another remote read", async () => {
  const controller = new AbortController();
  controller.abort();
  let reads = 0;
  await expect(waitForSsmInvocation(async () => {
    reads += 1;
    return { Status: "InProgress" };
  }, undefined, 2, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(reads).toBe(0);
});

test("the instance role can encrypt and write only the three managed Nango API-key parameters", async () => {
  const compute = await Bun.file(resolve(import.meta.dir, "../../../infra/compute/main.tf")).text();
  const policy = compute.slice(
    compute.indexOf('resource "aws_iam_role_policy" "data"'),
    compute.indexOf('resource "aws_iam_instance_profile" "app"'),
  );
  expect(policy).toContain('{ Effect = "Allow", Action = ["kms:Encrypt"], Resource = [var.kms_key_arn] }');
  expect(policy.match(/NANGO_(?:DEPLOYER|PIPELINE|INTEGRATION_MANAGER)_API_KEY/g)).toHaveLength(3);
  expect(policy).toContain('Action = ["ssm:PutParameter"]');
  expect(policy).not.toMatch(/ssm:PutParameter[^}]+parameter\$\{var\.ssm_parameter_prefix\}\/\*/s);
  expect(policy).not.toContain("kms:GenerateDataKey");
});
