import { join } from "node:path";
import { ROOT } from "../../runner/agent.ts";

/**
 * LoCoMo is small enough to vendor and is deliberately not vendored anyway.
 *
 * Unlike LongMemEval's MIT dataset, `locomo10.json` is CC BY-NC 4.0. Pinning a download
 * keeps a NonCommercial corpus out of this repository's history while still making a run
 * as reproducible as a vendored one: the revision, the byte length and the digest are all
 * checked on every use.
 */
export const LOCOMO_DATASET = {
  repository: "snap-research/locomo",
  revision: "3eb6f2c585f5e1699204e3c3bdf7adc5c28cb376",
  file: "data/locomo10.json",
  bytes: 2_805_274,
  sha256: "79fa87e90f04081343b8c8debecb80a9a6842b76a7aa537dc9fdf651ea698ff4",
  license: "CC BY-NC 4.0",
} as const;

export const LOCOMO_DATASET_URL = `https://raw.githubusercontent.com/${
  LOCOMO_DATASET.repository
}/${LOCOMO_DATASET.revision}/${LOCOMO_DATASET.file}`;

export const LOCOMO_CACHE_ROOT = join(
  ROOT,
  ".eval-data",
  "locomo",
  LOCOMO_DATASET.revision,
);

export const LOCOMO_DATASET_FILE = "locomo10.json";

export const LOCOMO_DATASET_PATH = join(LOCOMO_CACHE_ROOT, LOCOMO_DATASET_FILE);
