import { chmod, copyFile, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { repository } from "./release.ts";
import { run, type RunOptions } from "./process.ts";
import type { ReleaseManifest } from "./types.ts";

type CommandRunner = (command: string[], options?: RunOptions) => Promise<string>;

type CliUpdateDependencies = {
  execute?: CommandRunner;
  fetcher?: typeof fetch;
  installPath?: string;
};

export function cliArtifactName(
  platform: NodeJS.Platform = process.platform,
  architecture: string = process.arch,
): string {
  if (platform !== "darwin" && platform !== "linux") {
    throw new Error(`Unsupported operating system: ${platform}`);
  }
  const releaseArchitecture = architecture === "x64"
    ? "amd64"
    : architecture === "arm64"
      ? "arm64"
      : null;
  if (!releaseArchitecture) throw new Error(`Unsupported architecture: ${architecture}`);
  return `context-use-${platform}-${releaseArchitecture}.tar.gz`;
}

export function defaultCliInstallPath(executable = process.execPath, home = homedir()): string {
  return basename(executable) === "context-use"
    ? resolve(executable)
    : resolve(home, ".local/bin/context-use");
}

export function releaseChecksum(checksums: string, artifact: string): string {
  for (const line of checksums.split("\n")) {
    const match = line.match(/^([a-f0-9]{64})\s+\*?(.+)$/);
    if (match?.[2] === artifact) return match[1]!;
  }
  throw new Error(`Release checksums do not contain ${artifact}`);
}

function releaseAssetUrl(version: string, asset: string): string {
  return `https://github.com/${repository}/releases/download/${version}/${asset}`;
}

async function download(fetcher: typeof fetch, url: string, description: string): Promise<Uint8Array> {
  const response = await fetcher(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`Unable to download ${description} (${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}

export async function installCliRelease(
  manifest: ReleaseManifest,
  dependencies: CliUpdateDependencies = {},
): Promise<string> {
  const execute = dependencies.execute ?? run;
  const fetcher = dependencies.fetcher ?? fetch;
  const installPath = resolve(dependencies.installPath ?? defaultCliInstallPath());
  const artifact = cliArtifactName();
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "context-use-update-"));
  const archivePath = join(temporaryDirectory, artifact);
  const stagedPath = `${installPath}.update-${process.pid}`;

  try {
    const [archive, checksumBytes] = await Promise.all([
      download(fetcher, releaseAssetUrl(manifest.version, artifact), "CLI release"),
      download(fetcher, releaseAssetUrl(manifest.version, "SHA256SUMS"), "release checksums"),
    ]);
    const expectedChecksum = releaseChecksum(new TextDecoder().decode(checksumBytes), artifact);
    const actualChecksum = new Bun.CryptoHasher("sha256").update(archive).digest("hex");
    if (actualChecksum !== expectedChecksum) throw new Error("CLI release checksum verification failed");

    await Bun.write(archivePath, archive, { mode: 0o600 });
    await execute(["gh", "attestation", "verify", archivePath, "--repo", repository], { quiet: true });
    const contents = (await execute(["tar", "-tzf", archivePath], { quiet: true }))
      .split("\n")
      .map((entry) => entry.replace(/^\.\//, ""))
      .filter(Boolean);
    if (contents.length !== 1 || contents[0] !== "context-use") {
      throw new Error("CLI release archive has unexpected contents");
    }
    await execute(["tar", "-xzf", archivePath, "-C", temporaryDirectory], { quiet: true });

    const extractedPath = join(temporaryDirectory, "context-use");
    await chmod(extractedPath, 0o755);
    const version = await execute([extractedPath, "version"], { quiet: true });
    if (version !== manifest.version) {
      throw new Error(`CLI release reported ${version || "no version"}; expected ${manifest.version}`);
    }

    await mkdir(dirname(installPath), { recursive: true });
    await copyFile(extractedPath, stagedPath);
    await chmod(stagedPath, 0o755);
    await rename(stagedPath, installPath);
    return installPath;
  } finally {
    await rm(stagedPath, { force: true });
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

export async function continueUpdateWithCli(executable: string, version: string): Promise<void> {
  const subprocess = Bun.spawn([executable, "update", "--version", version], {
    env: process.env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await subprocess.exited;
  if (exitCode !== 0) throw new Error(`Updated CLI failed while deploying ${version} (exit ${exitCode})`);
}
