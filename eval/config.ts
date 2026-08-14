import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { z } from "zod";
import { PROVIDERS, type EvalHarness } from "./runner/agent.ts";
import { CORPUS_IDS, type CorpusId } from "./runner/corpus/integrity.ts";
import { CORPUS_WINDOWS } from "./runner/corpus/records.ts";

/**
 * Which harness, which model, and which evaluation a local run uses.
 *
 * Every `bun run eval` command reads this, so the shape of a run is stated in one place
 * rather than reconstructed from whichever flags someone happened to type. `bun run eval
 * check` reports the resolved configuration and proves the parts of it that can only be
 * proved by using them, and `bun run eval run` executes exactly what it names.
 *
 * Three layers, each one overriding the last:
 *
 *   1. `eval/config.json` — committed, and the answer to "what does this repository run".
 *   2. `eval/config.local.json` — gitignored, so choosing another harness locally does not
 *      dirty the tree or land in a commit by accident.
 *   3. Flags — a one-off, and never a new default.
 *
 * `harness` merges field by field across those layers; `eval` is replaced whole, because
 * half of one selection merged into another describes a run nobody asked for.
 */

/** Runs every story in the suite, rather than one named story. */
export const ALL_STORIES = "all";

const count = z.number().int().min(1);
const corpusRun = {
  corpus: z.enum(CORPUS_IDS),
  window: z.enum(CORPUS_WINDOWS).default("full"),
  batches: count.optional(),
};

/**
 * Strict on purpose. A misspelled `batchs` that silently kept the default would report the
 * configuration it was asked for and measure a different one, and a field that belongs to
 * another command is the same mistake wearing a plausible name.
 */
const selectionSchema = z.discriminatedUnion("command", [
  z.strictObject({ command: z.literal("distill"), ...corpusRun }),
  z.strictObject({ command: z.literal("qa"), ...corpusRun }),
  z.strictObject({ command: z.literal("story"), story: z.string().min(1), repeat: count.optional() }),
  z.strictObject({ command: z.literal("journey"), repeat: count.optional() }),
  // The selectors LongMemEval's own command takes; which of them may be combined is the
  // runner's rule, and it already enforces it.
  z.strictObject({
    command: z.literal("longmem"),
    case: z.string().min(1).optional(),
    limit: count.optional(),
    stratify: count.optional(),
    all: z.boolean().optional(),
    sessionsPerBatch: count.optional(),
  }),
]);

const layerSchema = z.strictObject({
  harness: z.strictObject({
    provider: z.enum(PROVIDERS).optional(),
    model: z.string().min(1).optional(),
  }).optional(),
  eval: selectionSchema.optional(),
});

export type EvalSelection = z.infer<typeof selectionSchema>;

export type EvalConfig = {
  harness: EvalHarness;
  eval: EvalSelection;
  /** The files this configuration was read from, nearest last. */
  sources: string[];
};

export const CONFIG_PATH = join(import.meta.dir, "config.json");
export const LOCAL_CONFIG_PATH = join(import.meta.dir, "config.local.json");

/**
 * What a run means with no configuration at all: one day of the corpus that matches what
 * Context Use actually does.
 *
 * The dense window rather than the whole corpus, because amara's first thirty-nine days
 * carry one record each and its activity is in the eight busy ones. A default of `full`
 * with one batch distills a single record, which proves the path is alive and measures
 * nothing.
 */
const BUILT_IN: EvalConfig = {
  harness: { provider: "codex" },
  eval: { command: "distill", corpus: "amara-life-v1", window: "dense", batches: 1 },
  sources: [],
};

class ConfigError extends Error {}

function readLayer(path: string, base: EvalConfig): EvalConfig {
  let parsed: z.infer<typeof layerSchema>;
  try {
    parsed = layerSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    const detail = error instanceof z.ZodError
      ? error.issues.map((issue) => `${["config", ...issue.path].join(".")}: ${issue.message}`).join("\n  ")
      : (error as Error).message;
    throw new ConfigError(`${path}\n  ${detail}`);
  }
  const provider = parsed.harness?.provider ?? base.harness.provider;
  // A model belongs to the CLI that understands it, so changing provider without naming a
  // model drops the old one rather than handing a Claude model id to Codex.
  const model = parsed.harness?.model
    ?? (provider === base.harness.provider ? base.harness.model : undefined);
  return {
    harness: model === undefined ? { provider } : { provider, model },
    eval: parsed.eval ?? base.eval,
    sources: [...base.sources, path],
  };
}

export function loadEvalConfig(paths: string[] = [CONFIG_PATH, LOCAL_CONFIG_PATH]): EvalConfig {
  let config = BUILT_IN;
  for (const path of paths) {
    if (existsSync(path)) config = readLayer(path, config);
  }
  return config;
}

/** Where a resolved configuration came from, as repository-relative paths. */
export function configOrigin(config: EvalConfig): string {
  const root = join(import.meta.dir, "..");
  return config.sources.map((path) => relative(root, path)).join(", then ") || "the built-in defaults";
}

/** One line naming what a selection runs, for the setup check and the run header. */
export function describeSelection(selection: EvalSelection): string {
  const repeat = selection.command === "story" || selection.command === "journey"
    ? (selection.repeat && selection.repeat > 1 ? ` · ${selection.repeat} repetitions` : "")
    : "";
  switch (selection.command) {
    case "distill":
    case "qa": {
      const batches = selection.batches === undefined
        ? "every batch"
        : `${selection.batches} batch${selection.batches === 1 ? "" : "es"}`;
      const scope = `${selection.corpus} · ${selection.window} window · ${batches}`;
      return selection.command === "qa" ? `qa ${scope} · prepare, ask, score` : `distill ${scope}`;
    }
    case "story":
      return selection.story === ALL_STORIES
        ? `story suite · every story${repeat}`
        : `story ${selection.story}${repeat}`;
    case "journey":
      return `journey · the historical stories in order${repeat}`;
    case "longmem": {
      const scope = selection.case ?? (selection.all ? "every case" : undefined)
        ?? (selection.stratify ? `${selection.stratify} per question type` : undefined)
        ?? (selection.limit ? `the first ${selection.limit} cases` : "no case selected");
      return `longmemeval · ${scope}`;
    }
  }
}

/** The corpus a selection names, where it names one. */
export function selectionCorpus(selection: EvalSelection): CorpusId | undefined {
  return selection.command === "distill" || selection.command === "qa" ? selection.corpus : undefined;
}

export const configInternals = { BUILT_IN };
