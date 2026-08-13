import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./agent.ts";

/** Gitignored home for every locally recorded evaluation run. */
export const EVAL_RESULTS_ROOT = join(ROOT, "eval", "results");

const LEGACY_RESULTS_ROOT = join(ROOT, ".eval-results");

/**
 * Resolves a corpus run from an explicit path, a run id, or the latest-run pointer.
 * The legacy root remains readable so existing local iterations do not become stranded.
 */
export function resolveEvalRunDirectory(runId?: string, latest = "latest-distill"): string {
  if (runId && existsSync(runId)) return runId;

  let resolved = runId;
  if (!resolved) {
    const pointer = [EVAL_RESULTS_ROOT, LEGACY_RESULTS_ROOT]
      .map((root) => join(root, latest))
      .find(existsSync);
    if (!pointer) throw new Error(`No recorded eval run found under ${EVAL_RESULTS_ROOT}`);
    resolved = readFileSync(pointer, "utf8").trim();
  }

  for (const root of [EVAL_RESULTS_ROOT, LEGACY_RESULTS_ROOT]) {
    const directory = join(root, resolved);
    if (existsSync(directory)) return directory;
  }
  throw new Error(`No such run: ${runId ?? resolved}`);
}
