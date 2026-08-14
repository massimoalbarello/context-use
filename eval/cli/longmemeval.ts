import {
  ensureLongMemEvalDataset,
  listLongMemEvalCases,
  verifyLongMemEvalDataset,
} from "../data/longmemeval-v1/dataset.ts";
import {
  LONGMEMEVAL_DATASET,
  LONGMEMEVAL_DATASET_PATH,
} from "../data/longmemeval-v1/manifest.ts";
import {
  runLongMemEval,
  scoreLongMemEval,
  type LongMemEvalRunOptions,
} from "../runner/longmemeval/runner.ts";
import { style } from "../runner/terminal.ts";

export async function fetchLongMemEval(datasetPath?: string): Promise<void> {
  const path = await ensureLongMemEvalDataset(datasetPath ? { path: datasetPath } : {});
  console.log(style.green("✓ LongMemEval dataset ready"));
  console.log(path);
  if (path === LONGMEMEVAL_DATASET_PATH) {
    console.log(`${LONGMEMEVAL_DATASET.bytes.toLocaleString()} bytes · ${LONGMEMEVAL_DATASET.sha256}`);
  }
}

export async function verifyLongMemEval(datasetPath?: string): Promise<void> {
  const path = datasetPath ?? LONGMEMEVAL_DATASET_PATH;
  if (!await verifyLongMemEvalDataset(path)) {
    throw new Error(`${path} is missing or does not match the pinned LongMemEval dataset.`);
  }
  console.log(style.green(`✓ ${LONGMEMEVAL_DATASET.file} matches the pinned size and SHA-256`));
}

export async function listLongMemEval(datasetPath?: string, limit = 20): Promise<void> {
  const path = await ensureLongMemEvalDataset(datasetPath ? { path: datasetPath } : {});
  const cases = listLongMemEvalCases(path);
  for (const entry of cases.slice(0, limit)) {
    console.log(`${entry.questionId.padEnd(20)} ${entry.questionType}${entry.abstention ? " · abstention" : ""}`);
  }
  if (cases.length > limit) console.log(style.dim(`… ${cases.length - limit} more; pass --limit to show more`));
}

export async function runLongMemEvalCommand(options: LongMemEvalRunOptions): Promise<void> {
  await runLongMemEval(options);
}

export async function scoreLongMemEvalCommand(runId?: string): Promise<void> {
  await scoreLongMemEval(runId);
}
