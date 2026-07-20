import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { currentVersion } from "./release.ts";

type CliResult = { stdout: string; stderr: string; exitCode: number };

async function executeCli(args: string[], env?: Record<string, string | undefined>): Promise<CliResult> {
  const child = Bun.spawn([process.execPath, new URL("./main.ts", import.meta.url).pathname, ...args], {
    ...(env ? { env } : {}),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);

  return { stdout, stderr, exitCode };
}

async function runCli(...args: string[]): Promise<CliResult> {
  return executeCli(args);
}

test("version subcommand prints the release version", async () => {
  const result = await runCli("version");

  expect(result.stderr).toBe("");
  expect(result.exitCode).toBe(0);
  expect(result.stdout.trim()).toBe(currentVersion);
});

test("built-in version flag prints the release version", async () => {
  const result = await runCli("--version");

  expect(result.stderr).toBe("");
  expect(result.exitCode).toBe(0);
  expect(result.stdout.trim()).toBe(currentVersion);
});

test("root help lists the operational commands", async () => {
  const result = await runCli("--help");

  expect(result.stderr).toBe("");
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("setup");
  expect(result.stdout).not.toContain("recover-passkey");
  expect(result.stdout).toContain("destroy");
});

test("command help preserves release and purge options", async () => {
  const [update, destroy] = await Promise.all([
    runCli("update", "--help"),
    runCli("destroy", "--help"),
  ]);

  expect(update.exitCode).toBe(0);
  expect(update.stdout).toContain("--version");
  expect(destroy.exitCode).toBe(0);
  expect(destroy.stdout).toContain("--purge-data");
});

test("update succeeds without an active deployment", async () => {
  const home = await mkdtemp(join(tmpdir(), "context-use-cli-home-"));
  const manifestPath = join(home, "release-manifest.json");
  const manifest = {
    version: currentVersion,
    terraform: { minimum: "1.11.0", maximum_exclusive: "2.0.0" },
    deployment_bundle: {
      url: `https://github.com/massimoalbarello/context-use/releases/download/${currentVersion}/deployment.tar.gz`,
      sha256: "a".repeat(64),
    },
    images: {
      app: `ghcr.io/massimoalbarello/context-use@sha256:${"b".repeat(64)}`,
      backup: `ghcr.io/massimoalbarello/context-use-backup@sha256:${"c".repeat(64)}`,
    },
  };

  try {
    await Bun.write(manifestPath, JSON.stringify(manifest));
    const env = { ...process.env, HOME: home, CONTEXT_USE_RELEASE_MANIFEST: manifestPath };

    const withoutConfig = await executeCli(["update", "--version", currentVersion], env);
    expect(withoutConfig.exitCode).toBe(0);
    expect(withoutConfig.stderr).toBe("");
    expect(withoutConfig.stdout).toContain("No active context-use deployment; skipping deployment update");
    expect(withoutConfig.stdout).toContain(`CLI is at ${currentVersion}`);

    await Bun.write(join(home, ".config/context-use/config.json"), JSON.stringify({
      hostname: "context.example.com",
      phase: "destroyed",
    }), { createPath: true });
    const withoutCompute = await executeCli(["update", "--version", currentVersion], env);
    expect(withoutCompute.exitCode).toBe(0);
    expect(withoutCompute.stderr).toBe("");
    expect(withoutCompute.stdout).toContain("No active context-use deployment; skipping deployment update");
    expect(withoutCompute.stdout).toContain(`CLI is at ${currentVersion}`);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
