import type { CorpusWindow } from "../apps/server/src/corpus-records.ts";
import { runDistillation } from "../eval/distill.ts";
import { verifyCorpus, refreshCorpus } from "../eval/corpus-commands.ts";
import { connectProvider, runEval, scoreEval, type EvalProvider } from "../eval/runner.ts";

function usage(): never {
  console.error(`Usage:
  bun run eval connect <codex|claude>
  bun run eval distill [--provider <codex|claude>] [--window <dense|full>] [--days <n>]
  bun run eval run [--provider <codex|claude>]
  bun run eval score [run-id]
  bun run eval corpus:verify
  bun run eval corpus:refresh`);
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

function windowFrom(args: string[]): CorpusWindow {
  // Defaults to the same value compose.dev.yml gives the server, so both agree.
  const value = optionFrom(args, "window") ?? process.env.EVAL_CORPUS_WINDOW ?? "full";
  if (value !== "dense" && value !== "full") usage();
  return value;
}

function daysFrom(args: string[]): number | undefined {
  const value = optionFrom(args, "days");
  if (value === undefined) return undefined;
  const days = Number(value);
  if (!Number.isSafeInteger(days) || days < 1) usage();
  return days;
}

const [command, ...args] = process.argv.slice(2);

if (command === "connect") {
  const provider = args[0];
  if (provider !== "codex" && provider !== "claude") usage();
  connectProvider(provider);
} else if (command === "distill") {
  await runDistillation({
    provider: providerFrom(args),
    window: windowFrom(args),
    days: daysFrom(args),
  });
} else if (command === "run") {
  await runEval(providerFrom(args));
} else if (command === "score") {
  await scoreEval(args[0]);
} else if (command === "corpus:verify") {
  verifyCorpus();
} else if (command === "corpus:refresh") {
  await refreshCorpus();
} else {
  usage();
}
