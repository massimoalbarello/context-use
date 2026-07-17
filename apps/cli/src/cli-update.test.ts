import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { cliArtifactName, defaultCliInstallPath, installCliRelease, releaseChecksum } from "./cli-update.ts";
import { run, type RunOptions } from "./process.ts";
import type { ReleaseManifest } from "./types.ts";

test("release artifact names match the supported build matrix", () => {
  expect(cliArtifactName("darwin", "x64")).toBe("context-use-darwin-amd64.tar.gz");
  expect(cliArtifactName("linux", "arm64")).toBe("context-use-linux-arm64.tar.gz");
  expect(() => cliArtifactName("win32", "x64")).toThrow("Unsupported operating system");
  expect(() => cliArtifactName("linux", "riscv64")).toThrow("Unsupported architecture");
});

test("the updater replaces a compiled CLI in place and otherwise uses the installer location", () => {
  expect(defaultCliInstallPath("/opt/context-use", "/home/owner")).toBe("/opt/context-use");
  expect(defaultCliInstallPath("/usr/local/bin/bun", "/home/owner")).toBe("/home/owner/.local/bin/context-use");
});

test("release checksum selection requires the exact artifact name", () => {
  const digest = "a".repeat(64);
  expect(releaseChecksum(`${digest}  context-use-linux-amd64.tar.gz\n`, "context-use-linux-amd64.tar.gz")).toBe(digest);
  expect(() => releaseChecksum(`${digest}  other.tar.gz\n`, "context-use-linux-amd64.tar.gz")).toThrow("do not contain");
});

test("installCliRelease verifies and atomically replaces the target binary", async () => {
  const root = await mkdtemp(join(tmpdir(), "context-use-cli-update-test-"));
  const sourceDirectory = join(root, "source");
  const archivePath = join(root, cliArtifactName());
  const installPath = join(root, "bin/context-use");
  const manifest: ReleaseManifest = {
    version: "v9.8.7",
    terraform: { minimum: "1.11.0", maximum_exclusive: "2.0.0" },
    deployment_bundle: { url: "https://example.com/deployment.tar.gz", sha256: "b".repeat(64) },
    images: {
      app: `ghcr.io/example/app@sha256:${"c".repeat(64)}`,
      backup: `ghcr.io/example/backup@sha256:${"d".repeat(64)}`,
    },
  };

  try {
    await Bun.write(join(sourceDirectory, "context-use"), "#!/bin/sh\necho v9.8.7\n", { createPath: true });
    await chmod(join(sourceDirectory, "context-use"), 0o755);
    await Bun.write(installPath, "#!/bin/sh\necho v1.0.0\n", { createPath: true });
    await chmod(installPath, 0o755);
    expect(await run([installPath, "version"], { quiet: true })).toBe("v1.0.0");
    await run(["tar", "-czf", archivePath, "-C", sourceDirectory, "context-use"], { quiet: true });
    const archive = new Uint8Array(await Bun.file(archivePath).arrayBuffer());
    const digest = new Bun.CryptoHasher("sha256").update(archive).digest("hex");
    let attestationVerified = false;
    const execute = async (command: string[], options?: RunOptions): Promise<string> => {
      if (command[0] === "gh") {
        attestationVerified = true;
        return "";
      }
      return run(command, options);
    };
    const fetcher = async (input: string | URL | Request): Promise<Response> => {
      const url = input.toString();
      return url.endsWith("/SHA256SUMS")
        ? new Response(`${digest}  ${cliArtifactName()}\n`)
        : new Response(archive);
    };

    expect(await installCliRelease(manifest, { execute, fetcher: fetcher as typeof fetch, installPath })).toBe(installPath);
    expect(attestationVerified).toBe(true);
    expect(await run([installPath, "version"], { quiet: true })).toBe(manifest.version);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
