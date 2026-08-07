import { runStackCommand } from "./local-stack.ts";
import { connectProvider, runEval, scoreEval, type EvalProvider } from "../eval/runner.ts";

const LIFECYCLE_COMMANDS = ["up", "down", "destroy", "purge", "reset", "logs", "status", "url"] as const;

function usage(): never {
  console.error(`Usage:
  bun run eval <up|down|destroy|purge|reset|logs|status|url>
  bun run eval connect <codex|claude>
  bun run eval run [--provider <codex|claude>]
  bun run eval score [run-id]`);
  process.exit(1);
}

function providerFrom(args: string[]): EvalProvider {
  const index = args.indexOf("--provider");
  const value = index === -1 ? "codex" : args[index + 1];
  if (value !== "codex" && value !== "claude") usage();
  return value;
}

const [command, ...args] = process.argv.slice(2);

if (command && (LIFECYCLE_COMMANDS as readonly string[]).includes(command)) {
  runStackCommand("eval", command as (typeof LIFECYCLE_COMMANDS)[number]);
} else if (command === "connect") {
  const provider = args[0];
  if (provider !== "codex" && provider !== "claude") usage();
  connectProvider(provider);
} else if (command === "run") {
  await runEval(providerFrom(args));
} else if (command === "score") {
  await scoreEval(args[0]);
} else {
  usage();
}
