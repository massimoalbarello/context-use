import { profileCorpusCommand, scoreRunCommand } from "../eval/data/amara-life-v1/gold/commands.ts";
import { verifyCorpus, refreshCorpus } from "../eval/cli/corpus.ts";
import { DEFAULT_CORPUS_ID, isCorpusId, type CorpusId } from "../eval/runner/corpus/integrity.ts";
import type { CorpusWindow } from "../eval/runner/corpus/records.ts";
import { runDistillation } from "../eval/runner/distill.ts";
import { connectProvider, type EvalProvider } from "../eval/runner/agent.ts";
import {
  askQuestionsCommand,
  deriveQuestionsCommand,
  scoreAnswersCommand,
  seedCommand,
  verifyQuestionsCommand,
} from "../eval/cli/qa.ts";

function usage(): never {
  console.error(`Usage:
  bun run eval connect <codex|claude>
  bun run eval distill [--corpus <amara-life-v1|world-v1>] [--provider <codex|claude>]
                       [--window <dense|full>] [--batches <n>]
  bun run eval corpus:verify [--corpus <id>]
  bun run eval corpus:refresh [--corpus <id>]
  bun run eval gold:profile [--write]              amara-life-v1 structural check
  bun run eval gold:check [run-id]
  bun run eval qa:ask [run-id] [--provider <codex|claude>] [--only <q-0007>] [--limit <n>] [--all]
  bun run eval qa:score [run-id]

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

function optionFrom(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
}

function providerFrom(args: string[]): EvalProvider {
  const value = optionFrom(args, "provider") ?? "codex";
  if (value !== "codex" && value !== "claude") usage();
  return value;
}

function corpusFrom(args: string[]): CorpusId {
  const value = optionFrom(args, "corpus") ?? DEFAULT_CORPUS_ID;
  if (!isCorpusId(value)) usage();
  return value;
}

function windowFrom(args: string[]): CorpusWindow {
  // Defaults to the same value compose.dev.yml gives the server, so both agree.
  const value = optionFrom(args, "window") ?? process.env.EVAL_CORPUS_WINDOW ?? "full";
  if (value !== "dense" && value !== "full") usage();
  return value;
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

if (command === "connect") {
  const provider = args[0];
  if (provider !== "codex" && provider !== "claude") usage();
  connectProvider(provider);
} else if (command === "distill") {
  await runDistillation({
    provider: providerFrom(args),
    corpus: corpusFrom(args),
    window: windowFrom(args),
    batches: countFrom(args, "batches", "days"),
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
  await seedCommand({ batches: countFrom(args, "batches") });
} else if (command === "qa:ask") {
  await askQuestionsCommand({
    runId: positional(args),
    provider: providerFrom(args),
    only: optionFrom(args, "only"),
    limit: countFrom(args, "limit"),
    all: args.includes("--all"),
  });
} else if (command === "qa:score") {
  scoreAnswersCommand(positional(args));
} else {
  usage();
}
