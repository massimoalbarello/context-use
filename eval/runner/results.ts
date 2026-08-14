import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./agent.ts";

/** Gitignored home for every locally recorded evaluation run. */
export const EVAL_RESULTS_ROOT = join(ROOT, "eval", "results");
export const EVAL_CORPUS_RESULTS_ROOT = join(EVAL_RESULTS_ROOT, "corpus");
export const EVAL_LONGMEM_RESULTS_ROOT = join(EVAL_RESULTS_ROOT, "longmemeval");
export const EVAL_STORY_RESULTS_ROOT = join(EVAL_RESULTS_ROOT, "stories");

const LEGACY_RESULTS_ROOT = join(ROOT, ".eval-results");
const CORPUS_RESULT_ROOTS = [
  EVAL_CORPUS_RESULTS_ROOT,
  EVAL_RESULTS_ROOT,
  LEGACY_RESULTS_ROOT,
];

/**
 * Resolves a corpus run from an explicit path, a run id, or the latest-run pointer.
 * Both earlier result roots remain readable so existing local iterations do not become
 * stranded when the on-disk grouping changes.
 */
export function resolveEvalRunDirectory(runId?: string, latest = "latest-distill"): string {
  if (runId && existsSync(runId)) return runId;

  let resolved = runId;
  if (!resolved) {
    const pointer = CORPUS_RESULT_ROOTS
      .map((root) => join(root, latest))
      .find(existsSync);
    if (!pointer) throw new Error(`No recorded corpus run found under ${EVAL_CORPUS_RESULTS_ROOT}`);
    resolved = readFileSync(pointer, "utf8").trim();
  }

  for (const root of CORPUS_RESULT_ROOTS) {
    const directory = join(root, resolved);
    if (existsSync(directory)) return directory;
  }
  throw new Error(`No such run: ${runId ?? resolved}`);
}
