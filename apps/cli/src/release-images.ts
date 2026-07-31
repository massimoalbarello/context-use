import { resolve } from "node:path";

const imagePatterns = {
  NANGO_IMAGE: /^ghcr\.io\/massimoalbarello\/context-use-nango@sha256:[a-f0-9]{64}$/,
  NANGO_INTEGRATIONS_IMAGE: /^ghcr\.io\/massimoalbarello\/context-use-nango@sha256:[a-f0-9]{64}$/,
} as const;

export type ReleaseImages = {
  nango: string;
  nangoIntegrations: string;
};

export function parseReleaseImages(input: string): ReleaseImages {
  const lines = input.endsWith("\n") ? input.slice(0, -1).split("\n") : input.split("\n");
  if (lines.length !== 2) {
    throw new Error("Release image metadata must contain exactly two lines");
  }

  const expectedKeys = Object.keys(imagePatterns) as Array<keyof typeof imagePatterns>;
  const parsed = new Map<string, string>();
  for (const line of lines) {
    const separator = line.indexOf("=");
    const key = line.slice(0, separator);
    const value = separator >= 0 ? line.slice(separator + 1) : "";
    if (!expectedKeys.includes(key as keyof typeof imagePatterns) || parsed.has(key)) {
      throw new Error("Release image metadata contains an unexpected or duplicate key");
    }
    const pattern = imagePatterns[key as keyof typeof imagePatterns];
    if (!pattern.test(value)) {
      throw new Error(`Release image metadata contains an invalid ${key} reference`);
    }
    parsed.set(key, value);
  }

  if (expectedKeys.some((key) => !parsed.has(key))) {
    throw new Error("Release image metadata is missing a required image");
  }
  if (parsed.get("NANGO_IMAGE") === parsed.get("NANGO_INTEGRATIONS_IMAGE")) {
    throw new Error("Release image metadata must use distinct Nango runtime and integrations digests");
  }

  return {
    nango: parsed.get("NANGO_IMAGE")!,
    nangoIntegrations: parsed.get("NANGO_INTEGRATIONS_IMAGE")!,
  };
}

export async function readReleaseImages(deploymentRoot: string): Promise<ReleaseImages> {
  const metadata = Bun.file(resolve(deploymentRoot, "deploy/release-images.env"));
  if (!await metadata.exists()) throw new Error("Release image metadata is missing");
  return parseReleaseImages(await metadata.text());
}
