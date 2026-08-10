import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Questions and their sealed answers, in the shapes `garrytan/gbrain-evals` already uses.
 *
 * A question file is upstream's `PublicQuery`: the `Query` shape with `gold` removed. An
 * answer file is upstream's `Gold`, keyed by question id and kept in a separate file the
 * system under test never sees. Holding to their shapes is the point — it is what lets
 * the same question file be handed to gbrain later, so the two systems can be scored on
 * one set rather than on two sets that merely sound alike.
 *
 * The two files are committed rather than derived on demand, for the same reason
 * `gold/profile.json` is: a change in the corpus or in the derivation should be a
 * reviewable diff, not a silent shift under a measurement.
 */

export const QA_ROOT = import.meta.dir;

/** Upstream's tier vocabulary, unchanged. */
export type Tier = "easy" | "medium" | "hard" | "adversarial" | "fuzzy" | "externally-authored";

/** Upstream's output-type vocabulary, unchanged. */
export type ExpectedOutputType =
  | "answer-string"
  | "canonical-entity-id"
  | "cited-source-pages"
  | "time-qualified-answer"
  | "abstention"
  | "contradiction-explanation"
  | "poison-flag"
  | "confidence-score";

/** What the agent is shown. Carries no answer, by construction. */
export type PublicQuery = {
  /** `q-0001` … matching upstream's `public-probe.schema.json` pattern. */
  id: string;
  tier: Tier;
  text: string;
  expected_output_type: ExpectedOutputType;
  as_of_date?: string;
  tags?: string[];
};

export type SealedAnswer = {
  id: string;
  /**
   * Upstream's own gold field: the page slugs a retrieval scorer would expect. Nothing
   * scores it yet — it is carried so a later retrieval comparison needs no new authoring.
   */
  relevant: string[];
  /** What a correct answer has to name. This is what `qa:score` actually checks. */
  expected_names: string[];
  /** The page the question is asked about, so a failure can be read back to its source. */
  seed: string;
  /** Upstream's link types for this template, carried for the same reason as `relevant`. */
  link_types: string[];
  /**
   * The batch by which the corpus has served every page needed to answer this.
   *
   * A short run processes the first N batches, so most pages do not exist yet and most
   * questions cannot be answered from anything. Scoring those would report a system
   * failure where the harness simply had not served the evidence. `qa:ask` and `qa:score`
   * therefore work on the questions due by the last batch a run processed — the same
   * discipline `gold/score.ts` already applies with `knowableFrom`, and it changes
   * nothing about the question set itself, so a full run is still upstream's 145.
   */
  due_batch: string;
  /**
   * Expected names the corpus states only in `_facts` and never in anyone's prose. A
   * system reading content alone cannot know these, so the scorer reports them rather
   * than counting them against a run.
   */
  unstated_in_prose?: string[];
  /**
   * The question text already contains this answer, because upstream titles its
   * one-on-ones `1:1 Wendy Hernandez + Mia Brown` and then asks who attended. Echoing the
   * question scores full marks with an empty knowledge base, so these are scored and
   * reported separately rather than dropped — dropping them would diverge from upstream's
   * 145 and cost the comparison this file exists to make possible.
   *
   * It lives here, on the sealed side, so the public question stays byte-for-byte the
   * question upstream would ask.
   */
  self_answering?: boolean;
};

export type QuestionSet = {
  corpusId: string;
  questions: PublicQuery[];
  answers: SealedAnswer[];
};

function corpusQaDirectory(corpusId: string): string {
  return join(QA_ROOT, corpusId);
}

export function questionsPath(corpusId: string): string {
  return join(corpusQaDirectory(corpusId), "questions.json");
}

export function answersPath(corpusId: string): string {
  return join(corpusQaDirectory(corpusId), "answers.json");
}

export function readQuestions(corpusId: string): PublicQuery[] {
  return JSON.parse(readFileSync(questionsPath(corpusId), "utf8")) as PublicQuery[];
}

export function readAnswers(corpusId: string): SealedAnswer[] {
  return JSON.parse(readFileSync(answersPath(corpusId), "utf8")) as SealedAnswer[];
}

/** Serialised the way the committed copies are written, so comparison is exact. */
export function serialise(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * The fields a question may carry. Anything else would be a gold field leaking into the
 * public file, which is the one thing sealing has to prevent.
 */
const PUBLIC_FIELDS = new Set([
  "id", "tier", "text", "expected_output_type", "as_of_date", "tags",
]);

export function goldFieldsIn(question: PublicQuery): string[] {
  return Object.keys(question).filter((key) => !PUBLIC_FIELDS.has(key));
}
