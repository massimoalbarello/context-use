import { join } from "node:path";
import { ROOT } from "../../runner/agent.ts";

/**
 * The benchmark is large and stays outside git. These pins make a cached download as
 * reproducible as a vendored corpus without putting 265 MiB into repository history.
 */
export const LONGMEMEVAL_DATASET = {
  repository: "xiaowu0162/longmemeval-cleaned",
  revision: "98d7416c24c778c2fee6e6f3006e7a073259d48f",
  file: "longmemeval_s_cleaned.json",
  bytes: 277_383_467,
  sha256: "d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442",
  license: "MIT",
} as const;

/** The exact upstream evaluator source whose prompts and model pin `judge.ts` ports. */
export const LONGMEMEVAL_EVALUATOR = {
  repository: "xiaowu0162/LongMemEval",
  revision: "9e0b455f4ef0e2ab8f2e582289761153549043fc",
  file: "src/evaluation/evaluate_qa.py",
} as const;

export const LONGMEMEVAL_DATASET_URL = `https://huggingface.co/datasets/${
  LONGMEMEVAL_DATASET.repository
}/resolve/${LONGMEMEVAL_DATASET.revision}/${LONGMEMEVAL_DATASET.file}`;

export const LONGMEMEVAL_CACHE_ROOT = join(
  ROOT,
  ".eval-data",
  "longmemeval",
  LONGMEMEVAL_DATASET.revision,
);

export const LONGMEMEVAL_DATASET_PATH = join(
  LONGMEMEVAL_CACHE_ROOT,
  LONGMEMEVAL_DATASET.file,
);
