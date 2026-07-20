import { resolve } from "node:path";
import { z } from "zod";
import { cacheDirectory } from "./paths.ts";
import { run } from "./process.ts";
import type { ReleaseManifest } from "./types.ts";

export const repository = "massimoalbarello/context-use";
export const currentVersion = "v0.1.25";

const digestImage = z.string().regex(/^ghcr\.io\/[a-z0-9_.-]+\/[a-z0-9_.-]+@sha256:[a-f0-9]{64}$/);
const manifestSchema = z.object({
  version: z.string().regex(/^v\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/),
  terraform: z.object({ minimum: z.string(), maximum_exclusive: z.string() }).strict(),
  deployment_bundle: z.object({ url: z.string().url().startsWith(`https://github.com/${repository}/`), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  images: z.object({ app: digestImage, backup: digestImage }).strict(),
}).strict();

export async function releaseManifest(version = "latest"): Promise<ReleaseManifest> {
  if (version !== "latest" && !/^v\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/.test(version)) {
    throw new Error("Release version must look like v1.2.3");
  }
  if (process.env.CONTEXT_USE_RELEASE_MANIFEST) {
    return manifestSchema.parse(await Bun.file(process.env.CONTEXT_USE_RELEASE_MANIFEST).json()) as ReleaseManifest;
  }
  const url = version === "latest"
    ? `https://github.com/${repository}/releases/latest/download/release-manifest.json`
    : `https://github.com/${repository}/releases/download/${version}/release-manifest.json`;
  try {
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok) throw new Error(`Unable to download release manifest (${response.status})`);
    const rawManifest = await response.text();
    const manifest = manifestSchema.parse(JSON.parse(rawManifest)) as ReleaseManifest;
    const path = resolve(cacheDirectory, `release-${manifest.version}.json`);
    await Bun.write(path, rawManifest, { createPath: true, mode: 0o600 });
    try {
      await run(["gh", "attestation", "verify", path, "--repo", repository], { quiet: true });
    } catch (error) {
      await Bun.file(path).delete();
      throw error;
    }
    return manifest;
  } catch (error) {
    if (version !== "latest") {
      const cached = Bun.file(resolve(cacheDirectory, `release-${version}.json`));
      if (await cached.exists()) return manifestSchema.parse(await cached.json()) as ReleaseManifest;
    }
    throw error;
  }
}

function sourceRoot(): string | null {
  const configured = process.env.CONTEXT_USE_BUNDLE_DIR;
  return configured ? resolve(configured) : null;
}

export async function deploymentRoot(manifest: ReleaseManifest): Promise<string> {
  const source = sourceRoot();
  if (source) return source;
  const root = resolve(cacheDirectory, "releases", manifest.version);
  if (await Bun.file(resolve(root, "infra/data/main.tf")).exists()) return root;
  if (!manifest.deployment_bundle.url || !manifest.deployment_bundle.sha256) {
    throw new Error("The release does not contain a deployment bundle");
  }
  const response = await fetch(manifest.deployment_bundle.url, { redirect: "follow" });
  if (!response.ok) throw new Error(`Unable to download deployment bundle (${response.status})`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const digest = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  if (digest !== manifest.deployment_bundle.sha256) throw new Error("Deployment bundle checksum verification failed");
  const archive = resolve(cacheDirectory, `deployment-${manifest.version}.tar.gz`);
  await Bun.write(archive, bytes, { createPath: true, mode: 0o600 });
  try {
    await run(["gh", "attestation", "verify", archive, "--repo", repository], { quiet: true });
    await run(["mkdir", "-p", root], { quiet: true });
    await run(["tar", "-xzf", archive, "-C", root], { quiet: true });
  } finally {
    await Bun.file(archive).delete();
  }
  return root;
}
