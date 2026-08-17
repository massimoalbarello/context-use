import { existsSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, relative } from "node:path";
import {
  LONGMEMEVAL_CASE_FILE,
  publicLongMemEvalCase,
} from "../../data/longmemeval-v1/corpus.ts";
import {
  ensureLongMemEvalDataset,
  selectAndReadLongMemEvalCases,
  validateLongMemEvalSelection,
  type LongMemEvalCase,
  type LongMemEvalSelection,
  type LongMemEvalQuestionType,
} from "../../data/longmemeval-v1/dataset.ts";
import {
  LONGMEMEVAL_DATASET,
  LONGMEMEVAL_EVALUATOR,
} from "../../data/longmemeval-v1/manifest.ts";
import { ROOT, harnessLabel, type EvalHarness, type EvalProvider } from "../agent.ts";
import { loadCorpus } from "../corpus/records.ts";
import { runCorpusDistillation } from "../distill.ts";
import { askQuestions } from "../qa/ask.ts";
import type { PublicQuery } from "../qa/questions.ts";
import { EVAL_LONGMEM_RESULTS_ROOT } from "../results.ts";
import { style } from "../terminal.ts";
import {
  judgeLongMemEvalAnswer,
  judgeLongMemEvalAnswerWithHarness,
  LONGMEMEVAL_JUDGE_MODEL,
  type LongMemEvalJudgement,
  type LongMemEvalJudgeProvider,
} from "./judge.ts";

export type LongMemEvalRunOptions = LongMemEvalSelection & {
  harness: EvalHarness;
  datasetPath?: string | undefined;
  sessionsPerBatch?: number | undefined;
};

export type LongMemEvalCaseResult = {
  questionId: string;
  questionType: LongMemEvalQuestionType;
  questionDate: string;
  question: string;
  referenceAnswer: unknown;
  abstention: boolean;
  sessions: number;
  batches: number;
  recordsServed: number;
  pages: number;
  hypothesis?: string | undefined;
  toolsUsed?: string[] | undefined;
  voidReason?: string | undefined;
};

export type LongMemEvalRunReport = {
  runId: string;
  benchmark: "longmemeval-v1";
  dataset: typeof LONGMEMEVAL_DATASET;
  evaluator: typeof LONGMEMEVAL_EVALUATOR;
  provider: EvalProvider;
  /** Null where the run used the CLI's own default model. */
  model: string | null;
  sessionsPerBatch: number;
  startedAt: string;
  completedAt: string;
  cases: LongMemEvalCaseResult[];
};

function safeId(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, "-");
}

function containerPath(hostPath: string): string {
  const withinRoot = relative(ROOT, hostPath);
  if (!withinRoot || withinRoot.startsWith("..") || withinRoot.startsWith("/")) {
    throw new Error(`Eval corpus path must live below ${ROOT}: ${hostPath}`);
  }
  return `/app/${withinRoot}`;
}

function publicQuestion(entry: LongMemEvalCase): PublicQuery {
  return {
    id: entry.questionId,
    tier: "hard",
    text: entry.question,
    expected_output_type: entry.abstention ? "abstention"
      : entry.questionType === "temporal-reasoning" ? "time-qualified-answer" : "answer-string",
    as_of_date: entry.questionDate,
    tags: ["longmemeval", entry.questionType],
  };
}

/**
 * The knowledge server's read-only tools, by their current names. Answering may read the
 * knowledge base and nothing else: mutations would rewrite what is being measured, and
 * `read_source_records` would answer from the corpus instead of the pages built from it.
 */
const LONGMEMEVAL_QA_READ_TOOLS = new Set([
  "browse_directory",
  "compare_page_versions",
  "list_assets",
  "list_page_changes",
  "list_page_versions",
  "read_asset",
  "read_directory",
  "read_page",
  "read_page_version",
  "read_skill",
  "search_pages",
]);

/**
 * Harness plumbing that reaches no knowledge and changes no state. Claude Code has to call
 * `ToolSearch` to load a deferred MCP schema before it can call the tool at all, so counting
 * it as a mutation voids every case on that harness.
 */
const LONGMEMEVAL_QA_HARNESS_TOOLS = new Set([
  "ToolSearch",
]);

/**
 * Providers report the same call under different names: Codex records the bare tool
 * (`search_pages`), while Claude Code records it namespaced by server
 * (`mcp__context_use_eval__search_pages`). Compare on the bare name so a run is judged by
 * what it did, not by which harness ran it.
 */
function bareToolName(tool: string): string {
  if (!tool.startsWith("mcp__")) return tool;
  const segments = tool.split("__");
  return segments[segments.length - 1] || tool;
}

function forbiddenQaTools(tools: string[]): string[] {
  return tools.filter((tool) => {
    const bare = bareToolName(tool);
    return !LONGMEMEVAL_QA_READ_TOOLS.has(bare) && !LONGMEMEVAL_QA_HARNESS_TOOLS.has(bare);
  });
}

/** Gold stays in memory until every tested agent has exited. */
function publicCaseResult(result: LongMemEvalCaseResult): Omit<LongMemEvalCaseResult, "referenceAnswer"> {
  const { referenceAnswer: _sealed, ...publicResult } = result;
  return publicResult;
}

function markdownReport(report: LongMemEvalRunReport): string {
  const answered = report.cases.filter((entry) => entry.hypothesis !== undefined);
  const lines = [
    `# LongMemEval QA — ${report.runId}`,
    "",
    `- **Harness:** ${harnessLabel(
      report.model ? { provider: report.provider, model: report.model } : { provider: report.provider },
    )}`,
    `- **Cases selected:** ${report.cases.length}`,
    `- **Cases answered:** ${answered.length}`,
    `- **Maximum sessions per distillation batch:** ${report.sessionsPerBatch}`,
    `- **Dataset revision:** ${report.dataset.revision}`,
    `- **Evaluator revision:** ${report.evaluator.revision}`,
    "",
  ];
  for (const entry of report.cases) {
    lines.push(`## ${entry.questionId} — ${entry.questionType}`, "", entry.question, "");
    lines.push(`- Sessions: ${entry.sessions}`);
    lines.push(`- Records served: ${entry.recordsServed}/${entry.sessions}`);
    lines.push(`- Pages after distillation: ${entry.pages}`);
    if (entry.voidReason) lines.push(`- **Void:** ${entry.voidReason}`);
    else lines.push(`- **Hypothesis:** ${entry.hypothesis}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

export async function runLongMemEval(options: LongMemEvalRunOptions): Promise<string> {
  // Reject an accidental unbounded invocation before doing even the large dataset download.
  validateLongMemEvalSelection(options);
  const datasetPath = await ensureLongMemEvalDataset(
    options.datasetPath ? { path: options.datasetPath } : {},
  );
  const cases = selectAndReadLongMemEvalCases(datasetPath, options);
  if (cases.length === 0) throw new Error("LongMemEval selection contains no cases");
  const sessionsPerBatch = options.sessionsPerBatch ?? 10;
  if (!Number.isSafeInteger(sessionsPerBatch) || sessionsPerBatch < 1 || sessionsPerBatch > 100) {
    throw new Error("--sessions-per-batch must be between 1 and 100");
  }

  const startedAt = new Date().toISOString();
  const runId = `${startedAt.replaceAll(":", "-").replace(".", "-")}-longmemeval-${options.harness.provider}`;
  const runDirectory = join(EVAL_LONGMEM_RESULTS_ROOT, runId);
  await mkdir(runDirectory, { recursive: true });
  console.log(style.heading(`\nLongMemEval QA run: ${runId}`));
  console.log(`${cases.length} isolated case(s) · at most ${sessionsPerBatch} sessions per distillation batch`);
  console.log(style.dim(`Dataset: ${datasetPath}`));
  console.log(style.dim(`Run files: ${runDirectory}`));

  const results: LongMemEvalCaseResult[] = [];
  const hypotheses: Array<{ question_id: string; hypothesis: string }> = [];

  /**
   * Written after every case, not just at the end. A case costs hours, and `longmem:score`
   * reads `report.json`; leaving it to the final case means an interrupted run scores
   * nothing at all, including the cases that did finish.
   */
  const persistRun = async (): Promise<string> => {
    const report: LongMemEvalRunReport = {
      runId,
      benchmark: "longmemeval-v1",
      dataset: LONGMEMEVAL_DATASET,
      evaluator: LONGMEMEVAL_EVALUATOR,
      provider: options.harness.provider,
      model: options.harness.model ?? null,
      sessionsPerBatch,
      startedAt,
      completedAt: new Date().toISOString(),
      cases: results,
    };
    await Bun.write(join(runDirectory, "hypotheses.jsonl"),
      hypotheses.map((item) => JSON.stringify(item)).join("\n") + (hypotheses.length ? "\n" : ""));
    await Bun.write(join(runDirectory, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    const path = join(runDirectory, "report.md");
    await Bun.write(path, markdownReport(report));
    await Bun.write(join(EVAL_LONGMEM_RESULTS_ROOT, "latest"), `${runId}\n`);
    return path;
  };

  for (const [index, entry] of cases.entries()) {
    console.log(style.heading(`\n\nCase ${index + 1}/${cases.length} · ${entry.questionId} · ${entry.questionType}`));
    const caseDirectory = join(runDirectory, `${String(index + 1).padStart(3, "0")}-${safeId(entry.questionId)}`);
    const sourceDirectory = join(caseDirectory, "source");
    const distillationDirectory = join(caseDirectory, "distillation");
    await mkdir(sourceDirectory, { recursive: true });
    await Bun.write(
      join(sourceDirectory, LONGMEMEVAL_CASE_FILE),
      `${JSON.stringify(publicLongMemEvalCase(
        entry,
        LONGMEMEVAL_DATASET.revision,
        sessionsPerBatch,
      ), null, 2)}\n`,
    );
    const corpus = loadCorpus(sourceDirectory);
    const distillation = await runCorpusDistillation({
      harness: options.harness,
      corpus,
      servedDirectory: containerPath(sourceDirectory),
      window: "full",
      runId: `${runId}-${entry.questionId}`,
      runDirectory: distillationDirectory,
      updateLatest: false,
      maxAttemptsPerBatch: 3,
      persistExactBatchCheckpoint: true,
    });

    const base: LongMemEvalCaseResult = {
      questionId: entry.questionId,
      questionType: entry.questionType,
      questionDate: entry.questionDate,
      question: entry.question,
      referenceAnswer: entry.referenceAnswer,
      abstention: entry.abstention,
      sessions: entry.sessions.length,
      batches: corpus.batches.length,
      recordsServed: distillation.servedRecords,
      pages: distillation.pages.length,
    };
    if (distillation.servedRecords !== distillation.requestedRecords) {
      const result = {
        ...base,
        voidReason: `distillation consumed ${distillation.servedRecords} of ${distillation.requestedRecords} sessions`,
      };
      results.push(result);
      await Bun.write(join(caseDirectory, "result.json"), `${JSON.stringify(publicCaseResult(result), null, 2)}\n`);
      await persistRun();
      console.log(style.yellow(`Skipping QA: ${result.voidReason}`));
      continue;
    }

    // The reset happened before distillation. Ask now, against that exact base, before the
    // next isolated case resets it. One question gets one fresh provider session.
    const qaDirectory = join(caseDirectory, "qa");
    await mkdir(qaDirectory, { recursive: true });
    const recorded = (await askQuestions({
      harness: options.harness,
      runDirectory: qaDirectory,
      questions: [publicQuestion(entry)],
    }))[0]!;
    const forbidden = forbiddenQaTools(recorded.toolsUsed);
    const result: LongMemEvalCaseResult = forbidden.length
      ? { ...base, voidReason: `QA used non-knowledge or mutating tool action(s): ${forbidden.join(", ")}` }
      : { ...base, hypothesis: recorded.text, toolsUsed: recorded.toolsUsed };
    results.push(result);
    if (result.hypothesis !== undefined) {
      hypotheses.push({ question_id: entry.questionId, hypothesis: result.hypothesis });
    }
    await Bun.write(join(caseDirectory, "result.json"), `${JSON.stringify(publicCaseResult(result), null, 2)}\n`);
    await persistRun();
    console.log(result.voidReason
      ? style.yellow(`Void: ${result.voidReason}`)
      : style.green(`Answer: ${result.hypothesis?.split("\n")[0] ?? ""}`));
  }

  const reportPath = await persistRun();
  console.log(style.green(`\n✓ LongMemEval run complete · ${hypotheses.length}/${results.length} cases answered`));
  console.log(`Report: ${style.blue(reportPath)}`);
  console.log(`Score:  ${style.blue(`bun run eval longmem:score ${runId}`)}`);
  return reportPath;
}

function resolveRun(runId?: string): string {
  if (runId && existsSync(runId)) return runId;
  const resolved = runId ?? (existsSync(join(EVAL_LONGMEM_RESULTS_ROOT, "latest"))
    ? readFileSync(join(EVAL_LONGMEM_RESULTS_ROOT, "latest"), "utf8").trim()
    : undefined);
  if (!resolved) throw new Error(`No LongMemEval run found under ${EVAL_LONGMEM_RESULTS_ROOT}`);
  const directory = join(EVAL_LONGMEM_RESULTS_ROOT, resolved);
  if (!existsSync(directory)) throw new Error(`No such LongMemEval run: ${resolved}`);
  return directory;
}

export type LongMemEvalScore = {
  scoredAt: string;
  model: string;
  judgeProvider: LongMemEvalJudgeProvider;
  /** Whether this used the benchmark's pinned GPT-4o model as well as its exact prompt. */
  officialModel: boolean;
  correct: number;
  scored: number;
  void: number;
  /** End-to-end accuracy: every selected case is in the denominator. */
  accuracy: number;
  /** Judge-only accuracy, reported separately when a harness failure made a case void. */
  judgeAccuracy: number;
  byType: Record<string, {
    correct: number;
    scored: number;
    void: number;
    total: number;
    accuracy: number;
  }>;
  cases: Array<{
    questionId: string;
    questionType: LongMemEvalQuestionType;
    correct?: boolean;
    judgeResponse?: string;
    judgeModel?: string;
    judgeProvider?: LongMemEvalJudgeProvider;
    voidReason?: string;
  }>;
};

export type LongMemEvalScoreOptions = {
  /** Defaults to the key-free Codex harness; use openai for the official pinned model. */
  judgeProvider?: LongMemEvalJudgeProvider | undefined;
  /** Test seam for deterministic unit scoring. */
  judge?: ((
    entry: Pick<LongMemEvalCase, "questionType" | "question" | "referenceAnswer" | "abstention">,
    hypothesis: string,
  ) => Promise<LongMemEvalJudgement>) | undefined;
};

export async function scoreLongMemEval(
  runId?: string,
  options: LongMemEvalScoreOptions = {},
): Promise<LongMemEvalScore> {
  const directory = resolveRun(runId);
  const report = JSON.parse(readFileSync(join(directory, "report.json"), "utf8")) as LongMemEvalRunReport;
  const judgeProvider = options.judgeProvider ?? "codex";
  const judgeDirectory = join(directory, "judge", judgeProvider);
  const cases: LongMemEvalScore["cases"] = [];
  const judgements: LongMemEvalJudgement[] = [];
  for (const [index, entry] of report.cases.entries()) {
    if (entry.voidReason || entry.hypothesis === undefined) {
      cases.push({
        questionId: entry.questionId,
        questionType: entry.questionType,
        voidReason: entry.voidReason ?? "no hypothesis was recorded",
      });
      continue;
    }
    const judged = options.judge
      ? await options.judge(entry, entry.hypothesis)
      : judgeProvider === "openai"
        ? await judgeLongMemEvalAnswer(entry, entry.hypothesis)
        : await judgeLongMemEvalAnswerWithHarness(entry, entry.hypothesis, {
            provider: judgeProvider,
            runDirectory: judgeDirectory,
            id: `judge-${String(index + 1).padStart(3, "0")}-${safeId(entry.questionId)}`,
          });
    judgements.push(judged);
    cases.push({
      questionId: entry.questionId,
      questionType: entry.questionType,
      correct: judged.correct,
      judgeResponse: judged.response,
      judgeModel: judged.model,
      judgeProvider: judged.provider,
    });
    console.log(`${judged.correct ? style.green("✓") : style.red("✗")} ${entry.questionId}  ${entry.question}`);
  }
  const answered = cases.filter((entry) => entry.correct !== undefined);
  const correct = answered.filter((entry) => entry.correct).length;
  const byType: LongMemEvalScore["byType"] = {};
  for (const questionType of new Set(cases.map((entry) => entry.questionType))) {
    const typeCases = cases.filter((entry) => entry.questionType === questionType);
    const scoredTypeCases = typeCases.filter((entry) => entry.correct !== undefined);
    const typeCorrect = scoredTypeCases.filter((entry) => entry.correct).length;
    byType[questionType] = {
      correct: typeCorrect,
      scored: scoredTypeCases.length,
      void: typeCases.length - scoredTypeCases.length,
      total: typeCases.length,
      accuracy: typeCorrect / typeCases.length,
    };
  }
  const score: LongMemEvalScore = {
    scoredAt: new Date().toISOString(),
    model: judgements[0]?.model ?? (judgeProvider === "openai"
      ? LONGMEMEVAL_JUDGE_MODEL
      : `${judgeProvider}-subscription`),
    judgeProvider: judgements[0]?.provider ?? judgeProvider,
    officialModel: judgements[0]?.officialModel ?? judgeProvider === "openai",
    correct,
    scored: answered.length,
    void: cases.length - answered.length,
    accuracy: cases.length ? correct / cases.length : 0,
    judgeAccuracy: answered.length ? correct / answered.length : 0,
    byType,
    cases,
  };
  const serializedScore = `${JSON.stringify(score, null, 2)}\n`;
  // Keep judge variants side by side for comparison; qa-score.json remains the most
  // recently requested view for existing result readers.
  await Bun.write(join(directory, `qa-score-${score.judgeProvider}.json`), serializedScore);
  await Bun.write(join(directory, "qa-score.json"), serializedScore);
  console.log(style.heading(`\nEnd-to-end LongMemEval QA accuracy: ${correct}/${cases.length} · ${(
    score.accuracy * 100).toFixed(1)}%`));
  console.log(score.officialModel
    ? `Judge: official ${score.model}`
    : `Judge: ${score.model} · official prompt, non-official model`);
  if (score.void) {
    console.log(style.yellow(
      `${score.void} void case(s) count as end-to-end failures; judge-only accuracy is ${correct}/${answered.length}.`,
    ));
  }
  return score;
}

export const longMemEvalRunnerInternals = {
  containerPath,
  forbiddenQaTools,
  publicCaseResult,
  publicQuestion,
};
