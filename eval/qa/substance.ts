import { readFileSync } from "node:fs";
import type { PageSnapshot } from "../snapshot.ts";

/**
 * How much substance a distillation run wrote, read straight off its snapshots.
 *
 * `qa:score` is the measurement that matters, and it costs an agent session per question
 * and mixes distillation with retrieval. This costs nothing and isolates the write side,
 * which makes it the instrument to iterate against: a change to the guides shows up here
 * in a second, and only a change that shows up here is worth spending an hour scoring.
 *
 * Two numbers, because the corpus run turned up two distinct failures.
 *
 * **Particulars.** A knowledge base earns its keep on the figure, the name and the term,
 * and the way it loses them is by recording that a conversation happened instead of what
 * it established — *supplied cap-table context* where the evidence said *came in at 8% for
 * $1.2M*. The share of timeline events carrying a figure, and the share whose verb only
 * names a speech act, measure that directly.
 *
 * **Throughput.** Pages written per record served. A run that writes forty pages from six
 * records and four from seventy-two is not being selective, it is being overwhelmed, and
 * an average hides it — so this is reported per batch as well as overall.
 *
 * Both are descriptive. Neither has a target, and neither belongs in a pass/fail gate:
 * a corpus of genuinely unremarkable days *should* score low on both.
 */

export type BatchSubstance = {
  batch: string;
  records: number;
  mutations: number;
  /** Pages written per record served. The spread across batches is the signal. */
  yield: number;
};

export type Substance = {
  pages: number;
  timelineEvents: number;
  distinctFigures: number;
  /** Timeline events stating a figure or a quoted phrase. */
  withParticulars: number;
  /** Timeline events whose verb only names the act of communicating. */
  narrating: number;
  batches: BatchSubstance[];
};

const FIGURE = /\$\d[\d.,]*\s?(?:[MBK]\b|million|billion|thousand)?|\b\d+(?:\.\d+)?%|\b\d[\d.,]*\s?(?:x|months?|weeks?|days?)\b/i;
/** Verbs that name the act of communicating rather than what was communicated. */
const NARRATION = /\b(?:discussed|reviewed|flagged|shared|offered|sought|proposed|raised|noted|provided|supplied|surfaced|explored|considered|covered|walked through|gave an update|framed|touched on)\b/i;

/** Lines of a `timeline` page that are timeline events rather than headings. */
export function timelineEvents(pages: PageSnapshot[]): string[] {
  return pages
    .filter((page) => page.path.endsWith("/timeline"))
    .flatMap((page) => page.body.split("\n"))
    .filter((line) => /^\s*-\s+\*\*/.test(line));
}

export function measureSubstance(pages: PageSnapshot[], batches: BatchSubstance[]): Substance {
  const events = timelineEvents(pages);
  const figures = pages.flatMap((page) => page.body.match(new RegExp(FIGURE, "gi")) ?? []);
  return {
    pages: pages.length,
    timelineEvents: events.length,
    distinctFigures: new Set(figures.map((figure) => figure.toLowerCase().trim())).size,
    withParticulars: events.filter((line) => FIGURE.test(line) || /["“']/.test(line)).length,
    narrating: events.filter((line) => NARRATION.test(line)).length,
    batches,
  };
}

type Report = {
  batches?: { batch?: string; changes?: { change?: string }[] }[];
};

/** Reads a recorded run: its final snapshot for the prose, its report for the throughput. */
export function measureRun(directory: string, snapshotFile: string, recordsPerBatch: Record<string, number>): Substance {
  const pages = JSON.parse(readFileSync(`${directory}/${snapshotFile}`, "utf8")) as PageSnapshot[];
  const report = JSON.parse(readFileSync(`${directory}/report.json`, "utf8")) as Report;
  const batches = (report.batches ?? []).map((entry) => {
    const batch = entry.batch ?? "";
    const mutations = (entry.changes ?? []).length;
    const records = recordsPerBatch[batch] ?? 0;
    return { batch, records, mutations, yield: records ? mutations / records : 0 };
  });
  return measureSubstance(pages, batches);
}
