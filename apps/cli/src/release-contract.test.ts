import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseReleaseManifest } from "./release.ts";
import { parseReleaseImages } from "./release-images.ts";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const digest = (character: string) => character.repeat(64);
const legacyManifest = {
  version: "v1.2.3",
  terraform: { minimum: "1.11.0", maximum_exclusive: "2.0.0" },
  deployment_bundle: {
    url: "https://github.com/massimoalbarello/context-use/releases/download/v1.2.3/context-use-deployment-v1.2.3.tar.gz",
    sha256: digest("a"),
  },
  images: {
    app: `ghcr.io/massimoalbarello/context-use@sha256:${digest("b")}`,
    backup: `ghcr.io/massimoalbarello/context-use-backup@sha256:${digest("c")}`,
  },
};

test("release manifests preserve the strict v0.1.46 bootstrap contract", () => {
  expect(parseReleaseManifest(legacyManifest)).toEqual(legacyManifest);
  expect(() => parseReleaseManifest({
    ...legacyManifest,
    images: {
      ...legacyManifest.images,
      nango: `ghcr.io/massimoalbarello/context-use-nango@sha256:${digest("d")}`,
    },
  })).toThrow();
  expect(() => parseReleaseManifest({
    ...legacyManifest,
    deployment_bundle: { ...legacyManifest.deployment_bundle, unexpected: true },
  })).toThrow();
  expect(() => parseReleaseManifest({ ...legacyManifest, schema_version: 2 })).toThrow();
});

async function parseNangoImage(metadata: string | null, key = "NANGO_IMAGE") {
  const directory = await mkdtemp(join(tmpdir(), "context-use-release-image-"));
  const metadataPath = join(directory, "release-images.env");
  try {
    if (metadata !== null) await Bun.write(metadataPath, metadata);
    const child = Bun.spawn([
      "bash",
      join(repositoryRoot, "deploy/nango/read-release-image.sh"),
      metadataPath,
      key,
    ], { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { stdout, stderr, exitCode };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("deployment bundles accept exactly the two digest-pinned Nango images", async () => {
  const nango = `ghcr.io/massimoalbarello/context-use-nango@sha256:${digest("d")}`;
  const integrations = `ghcr.io/massimoalbarello/context-use-nango@sha256:${digest("e")}`;
  const metadata = `NANGO_IMAGE=${nango}\nNANGO_INTEGRATIONS_IMAGE=${integrations}\n`;
  expect(parseReleaseImages(metadata)).toEqual({ nango, nangoIntegrations: integrations });
  expect(await parseNangoImage(metadata)).toEqual({
    stdout: `${nango}\n`,
    stderr: "",
    exitCode: 0,
  });
  expect(await parseNangoImage(metadata, "NANGO_INTEGRATIONS_IMAGE")).toEqual({
    stdout: `${integrations}\n`,
    stderr: "",
    exitCode: 0,
  });

  for (const metadata of [
    null,
    "",
    `NANGO_IMAGE=${nango}\nNANGO_IMAGE=${nango}\n`,
    `NANGO_IMAGE=${nango}\nNANGO_INTEGRATIONS_IMAGE=${nango}\n`,
    `NANGO_IMAGE=${nango}\nNANGO_INTEGRATIONS_IMAGE=${integrations}\nEXTRA=value\n`,
    `NANGO_IMAGE=ghcr.io/other/context-use-nango@sha256:${digest("d")}\nNANGO_INTEGRATIONS_IMAGE=${integrations}\n`,
    `NANGO_IMAGE=ghcr.io/massimoalbarello/context-use-nango:latest\nNANGO_INTEGRATIONS_IMAGE=${integrations}\n`,
    `NANGO_IMAGE=${nango}\nNANGO_INTEGRATIONS_IMAGE=ghcr.io/massimoalbarello/context-use-nango:integrations-latest\n`,
  ]) {
    expect((await parseNangoImage(metadata)).exitCode).not.toBe(0);
    if (metadata !== null) expect(() => parseReleaseImages(metadata)).toThrow();
  }
  expect((await parseNangoImage(metadata, "UNKNOWN_IMAGE")).exitCode).not.toBe(0);
});

test("release packaging keeps Nango out of the legacy manifest and inside the verified bundle", async () => {
  const [workflow, syncWorkflow, deploy] = await Promise.all([
    Bun.file(join(repositoryRoot, ".github/workflows/release.yml")).text(),
    Bun.file(join(repositoryRoot, ".github/workflows/sync-nango.yml")).text(),
    Bun.file(join(repositoryRoot, "deploy/deploy.sh")).text(),
  ]);

  expect(workflow).toContain("images:{app:$app,backup:$backup}}");
  expect(workflow).not.toContain("images:{app:$app,backup:$backup,nango:");
  expect(workflow).toContain('"$staging/deploy/release-images.env"');
  expect(workflow).toContain("${{ github.repository }}-nango:integrations-${{ github.ref_name }}");
  expect(workflow).toContain("NANGO_INTEGRATIONS_IMAGE=%s");

  const checksum = deploy.indexOf('sha256sum -c -');
  const stalePinRemoval = deploy.indexOf('rm -f "${root}/deploy/release-images.env"');
  const extraction = deploy.indexOf('tar -xzf "${archive}"');
  const imageValidation = deploy.indexOf("read-release-image.sh");
  const dockerPull = deploy.indexOf("docker compose --env-file");
  expect(checksum).toBeGreaterThan(-1);
  expect(checksum).toBeLessThan(stalePinRemoval);
  expect(stalePinRemoval).toBeLessThan(extraction);
  expect(extraction).toBeLessThan(imageValidation);
  expect(imageValidation).toBeLessThan(dockerPull);
  expect(deploy).not.toContain("CONTEXT_USE_NANGO_IMAGE");
  expect(deploy).toContain("NANGO_INTEGRATIONS_IMAGE=${nango_integrations_image}");

  expect(syncWorkflow.indexOf("Validate the updated production image"))
    .toBeLessThan(syncWorkflow.indexOf("Publish the validated update branch"));
});
