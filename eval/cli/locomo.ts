import {
  ensureLocomoDataset,
  listLocomoConversations,
  LOCOMO_CATEGORIES,
  LOCOMO_CATEGORY_NUMBERS,
  verifyLocomoDataset,
} from "../data/locomo-v1/dataset.ts";
import { LOCOMO_DATASET, LOCOMO_DATASET_PATH } from "../data/locomo-v1/manifest.ts";
import type { LocomoJudgeProvider } from "../runner/locomo/judge.ts";
import { runLocomo, scoreLocomo, type LocomoRunOptions } from "../runner/locomo/runner.ts";
import { style } from "../runner/terminal.ts";

export async function fetchLocomo(datasetPath?: string): Promise<void> {
  const path = await ensureLocomoDataset(datasetPath ? { path: datasetPath } : {});
  console.log(style.green("✓ LoCoMo dataset ready"));
  console.log(path);
  if (path === LOCOMO_DATASET_PATH) {
    console.log(`${LOCOMO_DATASET.bytes.toLocaleString()} bytes · ${LOCOMO_DATASET.sha256}`);
    console.log(style.dim(`License: ${LOCOMO_DATASET.license} — this dataset is not vendored.`));
  }
}

export async function verifyLocomo(datasetPath?: string): Promise<void> {
  const path = datasetPath ?? LOCOMO_DATASET_PATH;
  if (!await verifyLocomoDataset(path)) {
    throw new Error(`${path} is missing or does not match the pinned LoCoMo dataset.`);
  }
  console.log(style.green("✓ locomo10.json matches the pinned size and SHA-256"));
}

export async function listLocomo(datasetPath?: string): Promise<void> {
  const path = await ensureLocomoDataset(datasetPath ? { path: datasetPath } : {});
  const conversations = listLocomoConversations(path);
  const header = ["conversation", "sessions", "turns", "questions"]
    .map((label, index) => (index === 0 ? label.padEnd(14) : label.padStart(10))).join("");
  console.log(header + LOCOMO_CATEGORY_NUMBERS.map((category) =>
    `  ${category}:${LOCOMO_CATEGORIES[category]}`).join(""));
  for (const entry of conversations) {
    console.log(
      entry.sampleId.padEnd(14)
      + String(entry.sessions).padStart(10)
      + String(entry.turns).padStart(10)
      + String(entry.questions).padStart(10)
      + LOCOMO_CATEGORY_NUMBERS.map((category) =>
        `  ${String(entry.byCategory[category]).padStart(String(LOCOMO_CATEGORIES[category]).length + 2)}`).join(""),
    );
  }
  const totals = conversations.reduce((sum, entry) => sum + entry.questions, 0);
  console.log(style.dim(`\n${conversations.length} conversations · ${totals} questions`));
}

export async function runLocomoCommand(options: LocomoRunOptions): Promise<void> {
  await runLocomo(options);
}

export async function scoreLocomoCommand(
  runId?: string,
  judgeProvider?: LocomoJudgeProvider,
): Promise<void> {
  await scoreLocomo(runId, judgeProvider ? { judgeProvider } : {});
}
