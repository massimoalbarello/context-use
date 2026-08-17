import { profileCorpusCommand, scoreRunCommand } from "../eval/data/amara-life-v1/gold/commands.ts";
import { checkSetup } from "../eval/cli/check.ts";
import { verifyCorpus, refreshCorpus } from "../eval/cli/corpus.ts";
import { runConfiguredEval } from "../eval/cli/run.ts";
import { loadEvalConfig, selectionCorpus, type EvalConfig } from "../eval/config.ts";
import { DEFAULT_CORPUS_ID, isCorpusId, type CorpusId } from "../eval/runner/corpus/integrity.ts";
import type { CorpusWindow } from "../eval/runner/corpus/records.ts";
import { runDistillation } from "../eval/runner/distill.ts";
import { connectProvider, type EvalHarness, type EvalProvider } from "../eval/runner/agent.ts";
import {
  askQuestionsCommand,
  deriveQuestionsCommand,
  scoreAnswersCommand,
  seedCommand,
  verifyQuestionsCommand,
} from "../eval/cli/qa.ts";
import { listStories, runJourney, runStories } from "../eval/cli/story.ts";
import {
  fetchLongMemEval,
  listLongMemEval,
  runLongMemEvalCommand,
  scoreLongMemEvalCommand,
  verifyLongMemEval,
} from "../eval/cli/longmemeval.ts";
import type { LongMemEvalJudgeProvider } from "../eval/runner/longmemeval/judge.ts";

function usage(): never {
  console.error(`Usage:
  bun run eval check [--no-probe]                   prove the configured setup can run
  bun run eval run                                  run the configured eval on the configured harness
  bun run eval connect <codex|claude>
  bun run eval distill [--corpus <amara-life-v1|world-v1>] [--provider <codex|claude>]
                       [--model <id>] [--window <dense|full>] [--batches <n>]
  bun run eval corpus:verify [--corpus <id>]
  bun run eval corpus:refresh [--corpus <id>]
  bun run eval gold:profile [--write]              amara-life-v1 structural check
  bun run eval gold:check [run-id]
  bun run eval qa:ask [run-id] [--provider <codex|claude>] [--model <id>]
                      [--only <q-0007>] [--limit <n>] [--all]
  bun run eval qa:score [run-id]
  bun run eval story:list
  bun run eval story:run (--story <id> | --all) [--provider <codex|claude>] [--model <id>] [--repeat <n>]
  bun run eval journey:run [--provider <codex|claude>] [--model <id>] [--repeat <n>]
  bun run eval longmem:fetch [--dataset-path <path>]
  bun run eval longmem:verify [--dataset-path <path>]
  bun run eval longmem:list [--dataset-path <path>] [--limit <n>]
  bun run eval longmem:run (--case <id> | --limit <n> | --stratify <n> | --all)
                            [--provider <codex|claude>] [--model <id>] [--dataset-path <path>]
                            [--sessions-per-batch <n>]
  bun run eval longmem:score [run-id] [--judge-provider <codex|claude|openai>]

longmem:run selection, and what it costs. Every case is measured in isolation: it resets the
stack and distills that case's whole session history before asking its one question, so a
case is hours, not minutes — budget ~30 batches at roughly 10-20 minutes each.
  --limit <n>      the first n cases in dataset order. The head of the dataset is all one
                   question type, so this samples a type rather than the benchmark.
  --stratify <n>   n cases PER question type, so --stratify 10 selects 60 cases, not 10.
                   Use --stratify 1 for the cheapest run that still spans every type.
  --case <id>      one case by id, from longmem:list.

eval/config.json says which harness, which model and which eval a run uses, and every
command above takes its defaults from it. eval/config.local.json overrides it without
entering a commit; a flag overrides both for one command only.

Per corpus, before asking:
  bun run eval qa:seed [--batches <n>]             world-v1: put its pages in as they are
  bun run eval qa:derive [--write]                 world-v1: rebuild its questions from _facts
  bun run eval qa:verify                           amara-life-v1: check its authored questions

Both corpora are asked and scored by the same two commands. They differ only in how the
knowledge base under test comes to exist, and a run records which so a score can say what
it covers:

  world-v1       qa:seed  -> qa:ask -> qa:score    retrieval only
  amara-life-v1  distill  -> qa:ask -> qa:score    distillation and retrieval

A batch is the unit one run consumes: a calendar day for amara-life-v1, a slice of the page
order for world-v1. --days is accepted as an alias for --batches.`);
  process.exit(1);
}

/**
 * A configuration this file cannot read is reported as what it is, rather than as a stack
 * trace: it is a file someone just edited, and the line that names the offending field is
 * the whole answer.
 */
function configuration(): EvalConfig {
  try {
    return loadEvalConfig();
  } catch (error) {
    console.error(`\nThe evaluation configuration is not usable:\n  ${(error as Error).message}\n`);
    process.exit(1);
  }
}

const config = configuration();

function optionFrom(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
}

/**
 * The harness this command runs on: the configured one unless a flag says otherwise.
 *
 * A `--provider` that moves off the configured harness drops the configured model with it,
 * because a model id belongs to the CLI that understands it and handing Codex a Claude
 * model id fails in a way that looks like the eval failing.
 */
function harnessFrom(args: string[]): EvalHarness {
  const provider = optionFrom(args, "provider") ?? config.harness.provider;
  if (provider !== "codex" && provider !== "claude") usage();
  const inherited = provider === config.harness.provider ? config.harness.model : undefined;
  const model = optionFrom(args, "model") ?? inherited;
  return model === undefined ? { provider } : { provider, model };
}

function longMemJudgeProviderFrom(args: string[]): LongMemEvalJudgeProvider {
  const value = optionFrom(args, "judge-provider") ?? "codex";
  if (value !== "codex" && value !== "claude" && value !== "openai") usage();
  return value;
}

function corpusFrom(args: string[]): CorpusId {
  const value = optionFrom(args, "corpus") ?? selectionCorpus(config.eval) ?? DEFAULT_CORPUS_ID;
  if (!isCorpusId(value)) usage();
  return value;
}

function windowFrom(args: string[]): CorpusWindow {
  // Defaults to the same value compose.dev.yml gives the server, so both agree.
  const configured = config.eval.command === "distill" || config.eval.command === "qa"
    ? config.eval.window
    : undefined;
  const value = optionFrom(args, "window") ?? configured ?? process.env.EVAL_CORPUS_WINDOW ?? "full";
  if (value !== "dense" && value !== "full") usage();
  return value;
}

/**
 * The batch count, from the flag or from the configured selection.
 *
 * Falling back matters more here than anywhere else: the configured eval is one day of a
 * forty-seven day corpus, and a `distill` that took the corpus from the configuration but
 * not the count would quietly run the other forty-six.
 */
function batchesFrom(args: string[]): number | undefined {
  const configured = config.eval.command === "distill" || config.eval.command === "qa"
    ? config.eval.batches
    : undefined;
  return countFrom(args, "batches", "days") ?? configured;
}

function countFrom(args: string[], ...names: string[]): number | undefined {
  const value = names.map((name) => optionFrom(args, name)).find((found) => found !== undefined);
  if (value === undefined) return undefined;
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 1) usage();
  return count;
}

/** The first bare argument, so `qa:ask <run-id> --provider claude` reads naturally. */
function positional(args: string[]): string | undefined {
  const first = args[0];
  return first && !first.startsWith("--") ? first : undefined;
}

const [command, ...args] = process.argv.slice(2);

if (command === "check") {
  // `--provider` and `--model` are honoured here for the same reason as everywhere else:
  // checking a harness before adopting it is exactly when a one-off override earns itself.
  await checkSetup({ ...config, harness: harnessFrom(args) }, { probe: !args.includes("--no-probe") });
} else if (command === "run") {
  await runConfiguredEval(config);
} else if (command === "connect") {
  const provider: string = args[0] ?? config.harness.provider;
  if (provider !== "codex" && provider !== "claude") usage();
  connectProvider(provider as EvalProvider);
} else if (command === "distill") {
  await runDistillation({
    harness: harnessFrom(args),
    corpus: corpusFrom(args),
    window: windowFrom(args),
    batches: batchesFrom(args),
  });
} else if (command === "corpus:verify") {
  verifyCorpus(corpusFrom(args));
} else if (command === "corpus:refresh") {
  await refreshCorpus(corpusFrom(args));
} else if (command === "gold:profile") {
  profileCorpusCommand({ write: args.includes("--write") });
} else if (command === "gold:check") {
  scoreRunCommand(positional(args));
} else if (command === "qa:derive") {
  deriveQuestionsCommand({ write: args.includes("--write") });
} else if (command === "qa:verify") {
  verifyQuestionsCommand();
} else if (command === "qa:seed") {
  await seedCommand({ batches: batchesFrom(args) });
} else if (command === "qa:ask") {
  await askQuestionsCommand({
    runId: positional(args),
    harness: harnessFrom(args),
    only: optionFrom(args, "only"),
    limit: countFrom(args, "limit"),
    all: args.includes("--all"),
  });
} else if (command === "qa:score") {
  scoreAnswersCommand(positional(args));
} else if (command === "story:list") {
  listStories();
} else if (command === "story:run") {
  await runStories({
    harness: harnessFrom(args),
    story: optionFrom(args, "story"),
    all: args.includes("--all"),
    repeat: countFrom(args, "repeat"),
  });
} else if (command === "journey:run") {
  await runJourney({
    harness: harnessFrom(args),
    repeat: countFrom(args, "repeat"),
  });
} else if (command === "longmem:fetch") {
  await fetchLongMemEval(optionFrom(args, "dataset-path"));
} else if (command === "longmem:verify") {
  await verifyLongMemEval(optionFrom(args, "dataset-path"));
} else if (command === "longmem:list") {
  await listLongMemEval(optionFrom(args, "dataset-path"), countFrom(args, "limit"));
} else if (command === "longmem:run") {
  await runLongMemEvalCommand({
    harness: harnessFrom(args),
    datasetPath: optionFrom(args, "dataset-path"),
    caseId: optionFrom(args, "case"),
    limit: countFrom(args, "limit"),
    stratify: countFrom(args, "stratify"),
    all: args.includes("--all"),
    sessionsPerBatch: countFrom(args, "sessions-per-batch"),
  });
} else if (command === "longmem:score") {
  await scoreLongMemEvalCommand(positional(args), longMemJudgeProviderFrom(args));
} else {
  usage();
}
