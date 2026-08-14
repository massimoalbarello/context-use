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
import { ROOT, type EvalProvider } from "../agent.ts";
import { loadCorpus } from "../corpus/records.ts";
import { runCorpusDistillation } from "../distill.ts";
import { askQuestions } from "../qa/ask.ts";
import type { PublicQuery } from "../qa/questions.ts";
import { EVAL_LONGMEM_RESULTS_ROOT } from "../results.ts";
import { style } from "../terminal.ts";
import {
  judgeLongMemEvalAnswer,
  LONGMEMEVAL_JUDGE_MODEL,
  type LongMemEvalJudgement,
} from "./judge.ts";

export type LongMemEvalRunOptions = LongMemEvalSelection & {
  provider: EvalProvider;
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

function markdownReport(report: LongMemEvalRunReport): string {
  const answered = report.cases.filter((entry) => entry.hypothesis !== undefined);
  const lines = [
    `# LongMemEval QA — ${report.runId}`,
    "",
    `- **Provider:** ${report.provider}`,
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
  const runId = `${startedAt.replaceAll(":", "-").replace(".", "-")}-longmemeval-${options.provider}`;
  const runDirectory = join(EVAL_LONGMEM_RESULTS_ROOT, runId);
  await mkdir(runDirectory, { recursive: true });
  console.log(style.heading(`\nLongMemEval QA run: ${runId}`));
  console.log(`${cases.length} isolated case(s) · at most ${sessionsPerBatch} sessions per distillation batch`);
  console.log(style.dim(`Dataset: ${datasetPath}`));
  console.log(style.dim(`Run files: ${runDirectory}`));

  const results: LongMemEvalCaseResult[] = [];
  const hypotheses: Array<{ question_id: string; hypothesis: string }> = [];
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
      provider: options.provider,
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
      await Bun.write(join(caseDirectory, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
      console.log(style.yellow(`Skipping QA: ${result.voidReason}`));
      continue;
    }

    // The reset happened before distillation. Ask now, against that exact base, before the
    // next isolated case resets it. One question gets one fresh provider session.
    const qaDirectory = join(caseDirectory, "qa");
    await mkdir(qaDirectory, { recursive: true });
    const recorded = (await askQuestions({
      provider: options.provider,
      runDirectory: qaDirectory,
      questions: [publicQuestion(entry)],
    }))[0]!;
    const forbidden = recorded.toolsUsed.filter((tool) => tool.includes("read_source_records"));
    const result: LongMemEvalCaseResult = forbidden.length
      ? { ...base, voidReason: `QA bypassed the knowledge base with ${forbidden.join(", ")}` }
      : { ...base, hypothesis: recorded.text, toolsUsed: recorded.toolsUsed };
    results.push(result);
    if (result.hypothesis !== undefined) {
      hypotheses.push({ question_id: entry.questionId, hypothesis: result.hypothesis });
    }
    await Bun.write(join(caseDirectory, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
    console.log(result.voidReason
      ? style.yellow(`Void: ${result.voidReason}`)
      : style.green(`Answer: ${result.hypothesis?.split("\n")[0] ?? ""}`));
  }

  const report: LongMemEvalRunReport = {
    runId,
    benchmark: "longmemeval-v1",
    dataset: LONGMEMEVAL_DATASET,
    evaluator: LONGMEMEVAL_EVALUATOR,
    provider: options.provider,
    sessionsPerBatch,
    startedAt,
    completedAt: new Date().toISOString(),
    cases: results,
  };
  await Bun.write(join(runDirectory, "hypotheses.jsonl"),
    hypotheses.map((entry) => JSON.stringify(entry)).join("\n") + (hypotheses.length ? "\n" : ""));
  await Bun.write(join(runDirectory, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  const reportPath = join(runDirectory, "report.md");
  await Bun.write(reportPath, markdownReport(report));
  await Bun.write(join(EVAL_LONGMEM_RESULTS_ROOT, "latest"), `${runId}\n`);
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
    voidReason?: string;
  }>;
};

export async function scoreLongMemEval(
  runId?: string,
  judge: (
    entry: Pick<LongMemEvalCase, "questionType" | "question" | "referenceAnswer" | "abstention">,
    hypothesis: string,
  ) => Promise<LongMemEvalJudgement> = judgeLongMemEvalAnswer,
): Promise<LongMemEvalScore> {
  const directory = resolveRun(runId);
  const report = JSON.parse(readFileSync(join(directory, "report.json"), "utf8")) as LongMemEvalRunReport;
  const cases: LongMemEvalScore["cases"] = [];
  for (const entry of report.cases) {
    if (entry.voidReason || entry.hypothesis === undefined) {
      cases.push({
        questionId: entry.questionId,
        questionType: entry.questionType,
        voidReason: entry.voidReason ?? "no hypothesis was recorded",
      });
      continue;
    }
    const judged = await judge(entry, entry.hypothesis);
    cases.push({
      questionId: entry.questionId,
      questionType: entry.questionType,
      correct: judged.correct,
      judgeResponse: judged.response,
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
    model: LONGMEMEVAL_JUDGE_MODEL,
    correct,
    scored: answered.length,
    void: cases.length - answered.length,
    accuracy: cases.length ? correct / cases.length : 0,
    judgeAccuracy: answered.length ? correct / answered.length : 0,
    byType,
    cases,
  };
  await Bun.write(join(directory, "qa-score.json"), `${JSON.stringify(score, null, 2)}\n`);
  console.log(style.heading(`\nEnd-to-end LongMemEval QA accuracy: ${correct}/${cases.length} · ${(
    score.accuracy * 100).toFixed(1)}%`));
  if (score.void) {
    console.log(style.yellow(
      `${score.void} void case(s) count as end-to-end failures; judge-only accuracy is ${correct}/${answered.length}.`,
    ));
  }
  return score;
}

export const longMemEvalRunnerInternals = { containerPath, publicQuestion };
