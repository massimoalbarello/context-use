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

function releaseManifestFixture() {
  return {
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
  expect(result.stdout).toContain("cloud");
  expect(result.stdout).toContain("local");
  expect(result.stdout).toContain("agent-sync");
  expect(result.stdout).not.toContain("recover-passkey");
  // The deprecated top-level `update` alias exists only for an older binary's
  // self-update continuation and must stay out of the listing.
  expect(result.stdout).not.toContain("Deprecated alias");
});

test("command help exposes only intentional sensitive or destructive options", async () => {
  const [update, destroy, nango, nangoRestore, templatePlan, templateApply, agentSyncInstall] = await Promise.all([
    runCli("cloud", "update", "--help"),
    runCli("cloud", "destroy", "--help"),
    runCli("cloud", "nango", "--help"),
    runCli("cloud", "nango", "restore", "--help"),
    runCli("cloud", "template", "plan", "--help"),
    runCli("cloud", "template", "apply", "--help"),
    runCli("agent-sync", "install", "--help"),
  ]);

  expect(update.exitCode).toBe(0);
  expect(update.stdout).not.toContain("--version");
  expect(destroy.exitCode).toBe(0);
  expect(destroy.stdout).toContain("--purge-data");
  expect(nango.exitCode).toBe(0);
  expect(nango.stdout).not.toContain("credentials");
  expect(nangoRestore.exitCode).toBe(0);
  expect(nangoRestore.stdout).toContain("Restore Nango");
  expect(templatePlan.exitCode).toBe(0);
  expect(templatePlan.stdout).toContain("--force-template");
  expect(templatePlan.stdout).not.toContain("--overwrite-guides");
  expect(templatePlan.stdout).not.toContain("--overwrite-managed-pages");
  expect(templateApply.exitCode).toBe(0);
  expect(templateApply.stdout).toContain("--force-template");
  expect(templateApply.stdout).not.toContain("--overwrite-guides");
  expect(templateApply.stdout).not.toContain("--overwrite-managed-pages");
  expect(agentSyncInstall.exitCode).toBe(0);
  expect(agentSyncInstall.stdout).toContain("--codex-path");
  expect(agentSyncInstall.stdout).toContain("--claude-code-path");
  expect(agentSyncInstall.stdout).toContain("--claude-workspace-path");
});

test("the deprecated top-level update alias serves only a self-update continuation", async () => {
  const home = await mkdtemp(join(tmpdir(), "context-use-cli-home-"));
  const manifestPath = join(home, "release-manifest.json");
  try {
    await Bun.write(manifestPath, JSON.stringify(releaseManifestFixture()));
    const env = { ...process.env, HOME: home, CONTEXT_USE_RELEASE_MANIFEST: manifestPath };

    const typed = await executeCli(["update"], env);
    expect(typed.exitCode).not.toBe(0);
    expect(typed.stderr).toContain("`context-use update` was replaced by `context-use cloud update`");

    // An installation older than v0.1.69 finishes its update by spawning the
    // freshly downloaded binary as `context-use update`. That has to keep
    // working until no such installation remains.
    const continued = await executeCli(["update"], { ...env, CONTEXT_USE_UPDATE_CONTINUATION: "1" });
    expect(continued.exitCode).toBe(0);
    expect(continued.stdout).toContain("No active context-use deployment; skipping deployment update");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("cloud update succeeds without an active deployment", async () => {
  const home = await mkdtemp(join(tmpdir(), "context-use-cli-home-"));
  const manifestPath = join(home, "release-manifest.json");

  try {
    await Bun.write(manifestPath, JSON.stringify(releaseManifestFixture()));
    const env = { ...process.env, HOME: home, CONTEXT_USE_RELEASE_MANIFEST: manifestPath };

    const withoutConfig = await executeCli(["cloud", "update"], env);
    expect(withoutConfig.exitCode).toBe(0);
    expect(withoutConfig.stderr).toBe("");
    expect(withoutConfig.stdout).toContain("No active context-use deployment; skipping deployment update");
    expect(withoutConfig.stdout).toContain(`CLI is at ${currentVersion}`);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("update accepts the pinned continuation used by older CLIs", async () => {
  const home = await mkdtemp(join(tmpdir(), "context-use-cli-legacy-continuation-"));
  const manifestPath = join(home, "release-manifest.json");

  try {
    await Bun.write(manifestPath, JSON.stringify(releaseManifestFixture()));
    const result = await executeCli(["update", "--version", currentVersion], {
      ...process.env,
      HOME: home,
      CONTEXT_USE_RELEASE_MANIFEST: manifestPath,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("No active context-use deployment; skipping deployment update");
    expect(result.stdout).toContain(`CLI is at ${currentVersion}`);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("updated-CLI continuation cannot substitute another release manifest", async () => {
  const home = await mkdtemp(join(tmpdir(), "context-use-cli-continuation-"));
  const manifestPath = join(home, "release-manifest.json");
  try {
    await Bun.write(manifestPath, JSON.stringify({
      version: "v9.9.9",
      terraform: { minimum: "1.11.0", maximum_exclusive: "2.0.0" },
      deployment_bundle: {
        url: "https://github.com/massimoalbarello/context-use/releases/download/v9.9.9/deployment.tar.gz",
        sha256: "a".repeat(64),
      },
      images: {
        app: `ghcr.io/massimoalbarello/context-use@sha256:${"b".repeat(64)}`,
        backup: `ghcr.io/massimoalbarello/context-use-backup@sha256:${"c".repeat(64)}`,
      },
    }));
    const result = await executeCli(["update"], {
      ...process.env,
      HOME: home,
      CONTEXT_USE_RELEASE_MANIFEST: manifestPath,
      CONTEXT_USE_UPDATE_CONTINUATION: "1",
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(`expected ${currentVersion}`);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
