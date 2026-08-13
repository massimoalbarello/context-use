/**
 * The shape every vendored corpus is loaded into, whatever its upstream format.
 *
 * The unit that matters to a run is the **batch**: one automation run consumes exactly
 * one batch and stops, the way a scheduled production run consumes whatever its source
 * produced since the last checkpoint. What a batch means is the corpus's business —
 * `amara-life-v1` is a time series, so a batch is a calendar day; `world-v1` is a set of
 * biographical pages with no chronology of their own, so a batch is a fixed slice of the
 * page order. Nothing above this layer needs to know which.
 */

export const ITEM_TYPES = [
  // amara-life-v1 — raw activity
  "note", "meeting", "email", "slack", "calendar-event",
  // world-v1 — already-distilled pages
  "person", "company", "concept",
] as const;

export type CorpusItemType = (typeof ITEM_TYPES)[number];

export type CorpusRecord = {
  /** The upstream slug. One record carries exactly one upstream item. */
  slug: string;
  type: CorpusItemType;
  /** The unit one automation run consumes. Ordered lexicographically. */
  batch: string;
  markdown: string;
  /** Always `added`: a fixed corpus never revises an item it has already served. */
  action: "added" | "updated";
  /** Upstream items carried by this record, used to prove nothing is dropped. */
  itemSlugs: string[];
  /**
   * Calendar facts, present only where the corpus is a time series. `world-v1` pages
   * carry dates inside their prose but are not themselves dated events, so giving them a
   * day would fabricate a chronology the corpus does not have.
   */
  day?: string;
  timestamp?: string;
  /**
   * Upstream's own answer key for items it deliberately seeded. `read()` maps only lifecycle
   * action and Markdown into a `SourceRecord`, so this never reaches the agent.
   */
  perturbation?: { kind: string; fixtureId: string };
};

export type Corpus = {
  /** Whatever the corpus calls itself, which for a test fixture is not a vendored id. */
  corpusId: string;
  license: string;
  records: CorpusRecord[];
  /** Every batch holding at least one record, in the order they are served. */
  batches: string[];
  /** Every distinct calendar day, ascending. Empty for a corpus that has no chronology. */
  days: string[];
};

/**
 * A record from a time-series corpus, where the calendar facts are always present.
 *
 * `amara-life-v1` is one, and everything keyed to its days — the gold expectations, the
 * corpus profile — needs that guarantee. Asserting it once at the boundary is honest
 * about which corpora those consumers apply to, where a non-null assertion at each use
 * would only hide the question.
 */
export type DatedCorpusRecord = CorpusRecord & { day: string; timestamp: string };

export function datedRecords(corpus: Corpus): DatedCorpusRecord[] {
  const dated = corpus.records.filter((record): record is DatedCorpusRecord =>
    record.day !== undefined && record.timestamp !== undefined);
  if (dated.length !== corpus.records.length) {
    throw new Error(`${corpus.corpusId} has records without a calendar day, so it cannot be read as a time series.`);
  }
  return dated;
}

/** Groups loaded records into the `Corpus` envelope, preserving the given batch order. */
export function assembleCorpus(
  corpusId: string,
  license: string,
  records: CorpusRecord[],
): Corpus {
  return {
    corpusId,
    license,
    records,
    batches: [...new Set(records.map((record) => record.batch))],
    days: [...new Set(records.flatMap((record) => record.day ?? []))].sort(),
  };
}
