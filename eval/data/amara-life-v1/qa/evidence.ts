import { corpusDirectory } from "../../../runner/corpus/integrity.ts";
import { datedRecords } from "../../../runner/corpus/types.ts";
import { loadAmaraCorpus } from "../corpus.ts";
import { readEntities } from "../gold/expectations.ts";
import { forms, type PublicQuery, type SealedAnswer } from "../../../runner/qa/questions.ts";
import { normalise } from "../../../runner/text.ts";

/**
 * What makes `amara-life-v1`'s authored key checkable.
 *
 * `world-v1`'s questions are derived: they are read off `_facts` by a function, so the
 * corpus can re-derive them and any drift is a diff. Nothing like that exists here. This
 * corpus is raw email, Slack, notes and meeting write-ups with no key of any kind, so its
 * questions were read out by hand, and a hand-read claim about a corpus is worth exactly
 * what can be checked against the corpus.
 *
 * So every answer carries the verbatim quotes that force it, and this re-derives from the
 * pinned corpus everything that can be re-derived: that each quote is really in the record
 * it names, that `due_batch` really is the day the last of those records arrives, and that
 * the reference answer really does satisfy its own `expected_names`. None of that is a
 * matter of judgement. What is left to judgement — that the quotes entail the answer, and
 * that no other record contradicts it — was settled by three independent reads of the whole
 * corpus per question, and is recorded in the shared QA runner's README.
 */

const CORPUS_ID = "amara-life-v1";

/** True when `name` is asserted in `text`, on the same terms the scorer uses. */
function asserted(text: string, name: string): boolean {
  const needle = normalise(name);
  return Boolean(needle) && ` ${normalise(text)} `.includes(` ${needle} `);
}

/**
 * Every person the corpus can name.
 *
 * Read from the gold standard's entity list rather than derived, for the reason that file
 * gives: the corpus states some people only by a first name that context resolves, and no
 * rule finds those. Reusing it also keeps one answer to "who is in this corpus" instead of
 * two that can drift apart.
 */
export function amaraPeopleNames(): string[] {
  return readEntities()
    .filter((entity) => entity.kind === "person")
    .map((entity) => entity.name)
    .sort();
}

export type EvidenceIssue = { id: string; problem: string };

/**
 * Re-checks the authored key against the corpus. An empty result is the guarantee that
 * every quote in it is really there and every question is dated by its own evidence.
 */
export function verifyAmaraAnswers(
  questions: PublicQuery[],
  answers: SealedAnswer[],
  directory = corpusDirectory(CORPUS_ID),
): EvidenceIssue[] {
  const records = new Map(datedRecords(loadAmaraCorpus(directory)).map((record) => [record.slug, record] as const));
  const byId = new Map(answers.map((answer) => [answer.id, answer]));
  const issues: EvidenceIssue[] = [];
  const asked = new Map<string, string>();

  for (const question of questions) {
    const answer = byId.get(question.id);
    const fail = (problem: string): void => void issues.push({ id: question.id, problem });
    if (!answer) {
      fail("has no sealed answer");
      continue;
    }

    // The same question twice is a question weighted twice, which silently reweights the
    // whole score toward whatever it happens to ask.
    const duplicate = asked.get(normalise(question.text));
    if (duplicate) fail(`asks the same thing as ${duplicate}`);
    asked.set(normalise(question.text), question.id);

    if (!answer.evidence?.length) {
      fail("carries no evidence, so nothing about it can be checked");
      continue;
    }

    const days: string[] = [];
    for (const { record: slug, quote } of answer.evidence) {
      const record = records.get(slug);
      if (!record) {
        fail(`cites ${slug}, which is not a record in this corpus`);
        continue;
      }
      days.push(record.day);
      // Whitespace is the one thing normalised: the corpus wraps, and a quote read out of
      // it will not reproduce the wrapping. Every other character has to match.
      if (!record.markdown.replace(/\s+/g, " ").includes(quote.replace(/\s+/g, " ").trim())) {
        fail(`quote is not in ${slug}: ${JSON.stringify(quote.slice(0, 60))}`);
      }
    }

    const last = days.sort().at(-1);
    if (last && answer.due_batch !== last) {
      fail(`due_batch is ${answer.due_batch} but the last evidence day is ${last}`);
    }
    if (answer.seed !== answer.evidence[0]!.record) {
      fail(`seed ${answer.seed} is not the first record its evidence cites`);
    }

    for (const element of answer.expected_names) {
      // A required element the reference answer does not itself contain is grading
      // something other than this question.
      if (!forms(element).some((form) => asserted(answer.answer ?? "", form))) {
        fail(`no rendering of [${forms(element).join(" | ")}] appears in the reference answer`);
      }
      // A required element the question already supplies is satisfied by echoing the
      // question back, which is upstream's self-answering problem. Here the set is
      // authored, so it can simply not have any.
      if (forms(element).some((form) => asserted(question.text, form))) {
        fail(`[${forms(element).join(" | ")}] is already in the question, so echoing it would pass`);
      }
    }
  }
  return issues;
}
