import { existsSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { LOCOMO_CASE_FILE, publicLocomoCase } from "../../data/locomo-v1/corpus.ts";
import {
  ensureLocomoDataset,
  LOCOMO_CATEGORIES,
  LOCOMO_CATEGORY_NUMBERS,
  selectAndReadLocomoConversations,
  validateLocomoSelection,
  type LocomoCategory,
  type LocomoConversation,
  type LocomoSelection,
} from "../../data/locomo-v1/dataset.ts";
import {
  LOCOMO_AMEM_EVALUATOR,
  LOCOMO_DATASET,
  LOCOMO_EVALUATOR,
} from "../../data/locomo-v1/manifest.ts";
import { ROOT, harnessLabel, type EvalHarness, type EvalProvider } from "../agent.ts";
import { loadCorpus } from "../corpus/records.ts";
import { runCorpusDistillation } from "../distill.ts";
import { askQuestions } from "../qa/ask.ts";
import type { PublicQuery } from "../qa/questions.ts";
import { EVAL_LOCOMO_RESULTS_ROOT } from "../results.ts";
import { style } from "../terminal.ts";
import { askedLocomoQuestion, locomoAskPrompt, resolveLocomoAnswer } from "./ask.ts";
import {
  judgeLocomoAnswer,
  judgeLocomoAnswerWithHarness,
  LOCOMO_OPENAI_JUDGE_MODEL,
  type LocomoJudgement,
  type LocomoJudgeProvider,
} from "./judge.ts";
import {
  amemMetrics,
  AMEM_METRIC_NAMES,
  EMPTY_AMEM_METRICS,
  meanAmemMetrics,
  officialScore,
  type AmemMetrics,
} from "./metrics.ts";

/**
 * LoCoMo, run the way the benchmark defines it.
 *
 * The reset boundary is the **conversation**, not the question. One LoCoMo row is one
 * complete dated history and the ~105–260 questions asked of it, so all of that history is
 * distilled into one knowledge base and every one of its questions is then asked against
 * that same base. The stack resets when the runner moves to the next conversation, whose
 * history and questions are independent by benchmark definition. This is also what A-mem
 * does — a fresh memory system per sample — which is what makes the two comparable at all.
 *
 * Questions never mutate the knowledge base: only read-only tools are valid, and any
 * write, shell or web action voids that question.
 */

export type LocomoRunOptions = LocomoSelection & {
  harness: EvalHarness;
  datasetPath?: string | undefined;
  sessionsPerBatch?: number | undefined;
};

export type LocomoQuestionResult = {
  questionId: string;
  index: number;
  category: LocomoCategory;
  categoryName: string;
  question: string;
  /** The question as it was actually put, which differs from `question` for 2 and 5. */
  askedAs: string;
  hypothesis?: string | undefined;
  toolsUsed?: string[] | undefined;
  voidReason?: string | undefined;
};

export type LocomoConversationResult = {
  sampleId: string;
  sessions: number;
  turns: number;
  batches: number;
  recordsServed: number;
  pages: number;
  asOfDate: string;
  voidReason?: string | undefined;
  questions: LocomoQuestionResult[];
};

export type LocomoRunReport = {
  runId: string;
  benchmark: "locomo-v1";
  dataset: typeof LOCOMO_DATASET;
  evaluator: typeof LOCOMO_EVALUATOR;
  amemEvaluator: typeof LOCOMO_AMEM_EVALUATOR;
  provider: EvalProvider;
  model: string | null;
  sessionsPerBatch: number;
  /** Recorded because it is a deliberate departure from both upstreams' `random.random()`. */
  adversarialOptionOrder: "deterministic-by-question-id";
  startedAt: string;
  completedAt: string;
  conversations: LocomoConversationResult[];
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

const LOCOMO_QA_READ_TOOLS = new Set([
  "get_directory",
  "browse_directory",
  "list_directories",
  "get_page",
  "load_skill",
  "search_pages",
  "get_knowledge_changes",
  "get_page_delta",
  "get_page_history",
  "get_page_version",
  "list_assets",
  "get_asset",
]);

export function forbiddenQaTools(tools: string[]): string[] {
  return tools.filter((tool) => !LOCOMO_QA_READ_TOOLS.has(tool));
}

/**
 * The date the agent is told is "now".
 *
 * LoCoMo has no question date. Upstream hands a model the whole transcript, so the last
 * session's date is implicitly the present; an agent reading a distilled knowledge base has
 * no such anchor, and the temporal category would be unanswerable without one.
 */
export function asOfDate(conversation: LocomoConversation): string {
  return conversation.sessions[conversation.sessions.length - 1]!.dateTime;
}

function publicQuestion(asked: ReturnType<typeof askedLocomoQuestion>): PublicQuery {
  return {
    id: asked.question.id,
    tier: "hard",
    text: asked.text,
    expected_output_type: asked.question.category === 5 ? "abstention" : "answer-string",
    tags: ["locomo", asked.question.categoryName],
  };
}

function markdownReport(report: LocomoRunReport): string {
  const questions = report.conversations.flatMap((entry) => entry.questions);
  const answered = questions.filter((entry) => entry.hypothesis !== undefined);
  const lines = [
    `# LoCoMo QA — ${report.runId}`,
    "",
    `- **Harness:** ${harnessLabel(
      report.model ? { provider: report.provider, model: report.model } : { provider: report.provider },
    )}`,
    `- **Conversations:** ${report.conversations.length}`,
    `- **Questions asked:** ${answered.length} of ${questions.length}`,
    `- **Maximum sessions per distillation batch:** ${report.sessionsPerBatch}`,
    `- **Dataset revision:** ${report.dataset.revision}`,
    `- **Evaluator revision:** ${report.evaluator.revision}`,
    "",
  ];
  for (const entry of report.conversations) {
    lines.push(`## ${entry.sampleId}`, "");
    lines.push(`- Sessions: ${entry.sessions} (${entry.turns} turns) over ${entry.batches} batches`);
    lines.push(`- Records served: ${entry.recordsServed}/${entry.sessions}`);
    lines.push(`- Pages after distillation: ${entry.pages}`);
    if (entry.voidReason) lines.push(`- **Void:** ${entry.voidReason}`);
    const voided = entry.questions.filter((question) => question.voidReason).length;
    lines.push(`- Questions: ${entry.questions.length - voided} answered, ${voided} void`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

export async function runLocomo(options: LocomoRunOptions): Promise<string> {
  // Reject an unbounded invocation before the download, exactly as LongMemEval does.
  validateLocomoSelection(options);
  const datasetPath = await ensureLocomoDataset(
    options.datasetPath ? { path: options.datasetPath } : {},
  );
  const conversations = selectAndReadLocomoConversations(datasetPath, options);
  if (conversations.length === 0) throw new Error("LoCoMo selection contains no conversations");
  const sessionsPerBatch = options.sessionsPerBatch ?? 10;
  if (!Number.isSafeInteger(sessionsPerBatch) || sessionsPerBatch < 1 || sessionsPerBatch > 100) {
    throw new Error("--sessions-per-batch must be between 1 and 100");
  }

  const startedAt = new Date().toISOString();
  const runId = `${startedAt.replaceAll(":", "-").replace(".", "-")}-locomo-${options.harness.provider}`;
  const runDirectory = join(EVAL_LOCOMO_RESULTS_ROOT, runId);
  await mkdir(runDirectory, { recursive: true });
  const totalQuestions = conversations.reduce((sum, entry) => sum + entry.questions.length, 0);
  console.log(style.heading(`\nLoCoMo QA run: ${runId}`));
  console.log(`${conversations.length} conversation(s) · ${totalQuestions} question(s) · at most ${
    sessionsPerBatch} sessions per distillation batch`);
  console.log(style.dim(`Dataset: ${datasetPath}`));
  console.log(style.dim(`Run files: ${runDirectory}`));

  const results: LocomoConversationResult[] = [];
  const predictions: Array<{
    sample_id: string;
    question_id: string;
    category: LocomoCategory;
    question: string;
    prediction: string;
  }> = [];

  for (const [index, conversation] of conversations.entries()) {
    console.log(style.heading(`\n\nConversation ${index + 1}/${conversations.length} · ${
      conversation.sampleId} · ${conversation.sessions.length} sessions · ${
      conversation.questions.length} questions`));
    const caseDirectory = join(runDirectory, `${String(index + 1).padStart(3, "0")}-${safeId(conversation.sampleId)}`);
    const sourceDirectory = join(caseDirectory, "source");
    await mkdir(sourceDirectory, { recursive: true });
    await Bun.write(
      join(sourceDirectory, LOCOMO_CASE_FILE),
      `${JSON.stringify(publicLocomoCase(
        conversation,
        LOCOMO_DATASET.revision,
        sessionsPerBatch,
      ), null, 2)}\n`,
    );
    const corpus = loadCorpus(sourceDirectory);

    // The one reset for this conversation happens inside here, before its first batch.
    const distillation = await runCorpusDistillation({
      harness: options.harness,
      corpus,
      servedDirectory: containerPath(sourceDirectory),
      window: "full",
      runId: `${runId}-${conversation.sampleId}`,
      runDirectory: join(caseDirectory, "distillation"),
      updateLatest: false,
      maxAttemptsPerBatch: 3,
      persistExactBatchCheckpoint: true,
    });

    const base: LocomoConversationResult = {
      sampleId: conversation.sampleId,
      sessions: conversation.sessions.length,
      turns: conversation.sessions.reduce((sum, session) => sum + session.turns.length, 0),
      batches: corpus.batches.length,
      recordsServed: distillation.servedRecords,
      pages: distillation.pages.length,
      asOfDate: asOfDate(conversation),
      questions: [],
    };

    if (distillation.servedRecords !== distillation.requestedRecords) {
      // A partial history is not this conversation's knowledge base, so none of its
      // questions is a measurement. Every one of them counts as an end-to-end failure.
      const voidReason = `distillation consumed ${distillation.servedRecords} of ${
        distillation.requestedRecords} sessions`;
      const result: LocomoConversationResult = {
        ...base,
        voidReason,
        questions: conversation.questions.map((question) => ({
          questionId: question.id,
          index: question.index,
          category: question.category,
          categoryName: question.categoryName,
          question: question.question,
          askedAs: askedLocomoQuestion(question).text,
          voidReason,
        })),
      };
      results.push(result);
      await Bun.write(join(caseDirectory, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
      console.log(style.yellow(`Skipping ${conversation.questions.length} question(s): ${voidReason}`));
      continue;
    }

    const qaDirectory = join(caseDirectory, "qa");
    await mkdir(qaDirectory, { recursive: true });
    const asked = conversation.questions.map(askedLocomoQuestion);
    const now = asOfDate(conversation);
    const recorded = await askQuestions({
      harness: options.harness,
      runDirectory: qaDirectory,
      questions: asked.map(publicQuestion),
      prompt: (question) => {
        const match = asked.find((entry) => entry.question.id === question.id)!;
        return locomoAskPrompt(match, now);
      },
      onAnswer: (answer, position) => {
        const line = answer.text.split("\n")[0] ?? "";
        console.log(style.dim(`  ${position + 1}/${asked.length} ${answer.id}`) + `  ${line.slice(0, 80)}`);
      },
    });

    base.questions = asked.map((entry, position) => {
      const answer = recorded[position]!;
      const forbidden = forbiddenQaTools(answer.toolsUsed);
      const shared = {
        questionId: entry.question.id,
        index: entry.question.index,
        category: entry.question.category,
        categoryName: entry.question.categoryName,
        question: entry.question.question,
        askedAs: entry.text,
      };
      if (forbidden.length) {
        return { ...shared, voidReason: `QA used non-knowledge or mutating tool action(s): ${forbidden.join(", ")}` };
      }
      const hypothesis = resolveLocomoAnswer(entry, answer.text);
      predictions.push({
        sample_id: conversation.sampleId,
        question_id: entry.question.id,
        category: entry.question.category,
        question: entry.question.question,
        prediction: hypothesis,
      });
      return { ...shared, hypothesis, toolsUsed: answer.toolsUsed };
    });
    results.push(base);
    await Bun.write(join(caseDirectory, "result.json"), `${JSON.stringify(base, null, 2)}\n`);
  }

  const report: LocomoRunReport = {
    runId,
    benchmark: "locomo-v1",
    dataset: LOCOMO_DATASET,
    evaluator: LOCOMO_EVALUATOR,
    amemEvaluator: LOCOMO_AMEM_EVALUATOR,
    provider: options.harness.provider,
    model: options.harness.model ?? null,
    sessionsPerBatch,
    adversarialOptionOrder: "deterministic-by-question-id",
    startedAt,
    completedAt: new Date().toISOString(),
    conversations: results,
  };
  await Bun.write(join(runDirectory, "predictions.jsonl"),
    predictions.map((entry) => JSON.stringify(entry)).join("\n") + (predictions.length ? "\n" : ""));
  await Bun.write(join(runDirectory, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  const reportPath = join(runDirectory, "report.md");
  await Bun.write(reportPath, markdownReport(report));
  await Bun.write(join(EVAL_LOCOMO_RESULTS_ROOT, "latest"), `${runId}\n`);
  console.log(style.green(`\n✓ LoCoMo run complete · ${predictions.length}/${totalQuestions} questions answered`));
  console.log(`Report: ${style.blue(reportPath)}`);
  console.log(`Score:  ${style.blue(`bun run eval locomo:score ${runId}`)}`);
  return reportPath;
}

function resolveRun(runId?: string): string {
  if (runId && existsSync(runId)) return runId;
  const resolved = runId ?? (existsSync(join(EVAL_LOCOMO_RESULTS_ROOT, "latest"))
    ? readFileSync(join(EVAL_LOCOMO_RESULTS_ROOT, "latest"), "utf8").trim()
    : undefined);
  if (!resolved) throw new Error(`No LoCoMo run found under ${EVAL_LOCOMO_RESULTS_ROOT}`);
  const directory = join(EVAL_LOCOMO_RESULTS_ROOT, resolved);
  if (!existsSync(directory)) throw new Error(`No such LoCoMo run: ${resolved}`);
  return directory;
}

export type LocomoCategoryScore = {
  category: LocomoCategory;
  name: string;
  total: number;
  scored: number;
  void: number;
  /** Official LoCoMo F1, averaged over every selected question of this category. */
  officialF1: number;
  amem: AmemMetrics;
  judged?: { correct: number; scored: number; accuracy: number };
};

export type LocomoScore = {
  scoredAt: string;
  runId: string;
  total: number;
  scored: number;
  void: number;
  /**
   * The headline. Void questions are in the denominator, so an infrastructure failure
   * cannot flatter the number; `officialF1Scored` reports the same average over answered
   * questions only.
   */
  officialF1: number;
  officialF1Scored: number;
  amem: AmemMetrics;
  judge?: {
    provider: LocomoJudgeProvider;
    model: string;
    correct: number;
    scored: number;
    /** Void questions in the denominator, matching `officialF1`. */
    accuracy: number;
  };
  byCategory: LocomoCategoryScore[];
  questions: Array<{
    sampleId: string;
    questionId: string;
    category: LocomoCategory;
    officialF1?: number;
    amem?: AmemMetrics;
    judgeCorrect?: boolean;
    judgeResponse?: string;
    voidReason?: string;
  }>;
};

export type LocomoScoreOptions = {
  /** Omit to score deterministically only, which needs no session and no API key. */
  judgeProvider?: LocomoJudgeProvider | undefined;
  /** Test seam for deterministic unit scoring. */
  judge?: ((
    entry: { category: LocomoCategory; question: string; referenceAnswer: string },
    hypothesis: string,
  ) => Promise<LocomoJudgement>) | undefined;
};

/**
 * Scoring re-reads the dataset because the reference answers were never written into the
 * run: a run directory holds predictions and no gold, so a report can be read, shared or
 * kept without carrying the answer key alongside it.
 */
export async function scoreLocomo(
  runId?: string,
  options: LocomoScoreOptions = {},
): Promise<LocomoScore> {
  const directory = resolveRun(runId);
  const report = JSON.parse(readFileSync(join(directory, "report.json"), "utf8")) as LocomoRunReport;
  const datasetPath = await ensureLocomoDataset();
  const conversations = new Map(
    selectAndReadLocomoConversations(datasetPath, {
      limit: undefined,
      all: true,
    }).map((entry) => [entry.sampleId, entry]),
  );

  const questions: LocomoScore["questions"] = [];
  const judgeProvider = options.judgeProvider;
  const judgeDirectory = join(directory, "judge", judgeProvider ?? "none");
  let judgements: LocomoJudgement[] = [];

  for (const conversation of report.conversations) {
    const source = conversations.get(conversation.sampleId);
    if (!source) throw new Error(`Run names a conversation the dataset does not have: ${conversation.sampleId}`);
    const byId = new Map(source.questions.map((entry) => [entry.id, entry]));
    for (const entry of conversation.questions) {
      const gold = byId.get(entry.questionId);
      if (!gold) throw new Error(`Run names an unknown question: ${entry.questionId}`);
      if (entry.voidReason || entry.hypothesis === undefined) {
        questions.push({
          sampleId: conversation.sampleId,
          questionId: entry.questionId,
          category: entry.category,
          voidReason: entry.voidReason ?? "no answer was recorded",
        });
        continue;
      }
      const scored: LocomoScore["questions"][number] = {
        sampleId: conversation.sampleId,
        questionId: entry.questionId,
        category: entry.category,
        officialF1: officialScore(entry.hypothesis, gold.referenceAnswer, entry.category),
        amem: amemMetrics(entry.hypothesis, gold.referenceAnswer),
      };
      if (judgeProvider || options.judge) {
        const judged = options.judge
          ? await options.judge(
            { category: entry.category, question: entry.question, referenceAnswer: gold.referenceAnswer },
            entry.hypothesis,
          )
          : judgeProvider === "openai"
            ? await judgeLocomoAnswer(
              { category: entry.category, question: entry.question, referenceAnswer: gold.referenceAnswer },
              entry.hypothesis,
            )
            : await judgeLocomoAnswerWithHarness(
              { category: entry.category, question: entry.question, referenceAnswer: gold.referenceAnswer },
              entry.hypothesis,
              {
                provider: judgeProvider as EvalProvider,
                runDirectory: judgeDirectory,
                id: `judge-${safeId(entry.questionId)}`,
              },
            );
        judgements.push(judged);
        scored.judgeCorrect = judged.correct;
        scored.judgeResponse = judged.response;
      }
      questions.push(scored);
    }
  }

  const answered = questions.filter((entry) => entry.officialF1 !== undefined);
  const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);
  const officialTotal = sum(answered.map((entry) => entry.officialF1!));
  const judged = questions.filter((entry) => entry.judgeCorrect !== undefined);
  const judgeCorrect = judged.filter((entry) => entry.judgeCorrect).length;

  const byCategory: LocomoCategoryScore[] = LOCOMO_CATEGORY_NUMBERS.flatMap((category) => {
    const all = questions.filter((entry) => entry.category === category);
    if (all.length === 0) return [];
    const scoredHere = all.filter((entry) => entry.officialF1 !== undefined);
    const judgedHere = all.filter((entry) => entry.judgeCorrect !== undefined);
    const correctHere = judgedHere.filter((entry) => entry.judgeCorrect).length;
    return [{
      category,
      name: LOCOMO_CATEGORIES[category],
      total: all.length,
      scored: scoredHere.length,
      void: all.length - scoredHere.length,
      officialF1: sum(scoredHere.map((entry) => entry.officialF1!)) / all.length,
      amem: scaleAmem(meanAmemMetrics(scoredHere.map((entry) => entry.amem!)), scoredHere.length, all.length),
      ...(judgedHere.length ? { judged: { correct: correctHere, scored: judgedHere.length, accuracy: correctHere / all.length } } : {}),
    }];
  });

  const score: LocomoScore = {
    scoredAt: new Date().toISOString(),
    runId: report.runId,
    total: questions.length,
    scored: answered.length,
    void: questions.length - answered.length,
    officialF1: questions.length ? officialTotal / questions.length : 0,
    officialF1Scored: answered.length ? officialTotal / answered.length : 0,
    amem: scaleAmem(
      meanAmemMetrics(answered.map((entry) => entry.amem!)),
      answered.length,
      questions.length,
    ),
    ...(judged.length
      ? {
        judge: {
          provider: judgements[0]?.provider ?? judgeProvider ?? "codex",
          model: judgements[0]?.model ?? (judgeProvider === "openai"
            ? LOCOMO_OPENAI_JUDGE_MODEL
            : `${judgeProvider}-subscription`),
          correct: judgeCorrect,
          scored: judged.length,
          accuracy: questions.length ? judgeCorrect / questions.length : 0,
        },
      }
      : {}),
    byCategory,
    questions,
  };

  const suffix = score.judge ? `-judge-${score.judge.provider}` : "-deterministic";
  const serialized = `${JSON.stringify(score, null, 2)}\n`;
  await Bun.write(join(directory, `qa-score${suffix}.json`), serialized);
  await Bun.write(join(directory, "qa-score.json"), serialized);
  printLocomoScore(score);
  return score;
}

/**
 * Puts a void question into an A-mem average as a zero.
 *
 * `meanAmemMetrics` averages what it is given, so scoring only answered questions would
 * quietly drop failures out of the denominator. The official F1 keeps every selected
 * question in its denominator, and this keeps the second family honest the same way.
 */
function scaleAmem(mean: AmemMetrics, scored: number, total: number): AmemMetrics {
  if (total === 0) return { ...EMPTY_AMEM_METRICS };
  const factor = scored / total;
  const scaled = { ...EMPTY_AMEM_METRICS };
  for (const name of AMEM_METRIC_NAMES) scaled[name] = mean[name] * factor;
  return scaled;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function printLocomoScore(score: LocomoScore): void {
  console.log(style.heading(`\nLoCoMo · ${score.scored}/${score.total} questions answered`));
  console.log(`Official LoCoMo F1:  ${percent(score.officialF1)}   ${
    style.dim(`(${percent(score.officialF1Scored)} over answered questions only)`)}`);
  console.log(`A-mem F1 / BLEU-1:   ${percent(score.amem.f1)} / ${percent(score.amem.bleu1)}   ${
    style.dim("A-mem's own metric, not the official one")}`);
  if (score.judge) {
    console.log(`Judge accuracy:      ${percent(score.judge.accuracy)}   ${
      style.dim(`${score.judge.model} · this repository's rubric, not an official LoCoMo metric`)}`);
  }
  console.log("");
  for (const entry of score.byCategory) {
    const judgeColumn = entry.judged ? `  judge ${percent(entry.judged.accuracy)}` : "";
    console.log(`  ${String(entry.category)} ${entry.name.padEnd(12)} n=${
      String(entry.total).padStart(4)}  official F1 ${percent(entry.officialF1).padStart(6)}  A-mem F1 ${
      percent(entry.amem.f1).padStart(6)}  BLEU-1 ${percent(entry.amem.bleu1).padStart(6)}${judgeColumn}`);
  }
  if (score.void) {
    console.log(style.yellow(
      `\n${score.void} void question(s) count as failures in every headline above.`,
    ));
  }
}

export const locomoRunnerInternals = { containerPath, publicQuestion, scaleAmem };
