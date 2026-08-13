import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { corpusDirectory } from "../../../runner/corpus/integrity.ts";
import type { PublicQuery, QuestionSet, SealedAnswer } from "../../../runner/qa/questions.ts";
import { loadWorldCorpus } from "../corpus.ts";

/**
 * Derives `world-v1`'s questions and their sealed answers from each page's `_facts`.
 *
 * This is a port of `buildRelationalQueries` in gbrain-evals' `eval/runner/before-after.ts`,
 * kept deliberately faithful: the same four templates, the same "only entities that have
 * their own page count as answers" filter, and the same 145 questions. Matching their
 * derivation is the point — it is what makes a future gbrain run comparable rather than
 * merely similar.
 *
 * **This is the one module allowed to read `_facts`.** The corpus loader strips it, so
 * the serving path cannot see the answer key; question derivation reads the shards
 * directly and on purpose. Nothing here is imported by the loader or the reader.
 */

type Facts = {
  type: "person" | "company" | "meeting" | "concept";
  slug: string;
  name?: string;
  attendees?: string[];
  employees?: string[];
  founders?: string[];
  investors?: string[];
  advisors?: string[];
};

type Shard = {
  slug: string;
  title: string;
  compiled_truth: string;
  timeline: string | string[];
  _facts: Facts;
};

const NOT_CONTENT = new Set(["_ledger.json", "world.html"]);

function readShards(directory: string): Shard[] {
  return readdirSync(directory).sort()
    .filter((name) => name.endsWith(".json") && !NOT_CONTENT.has(name))
    .map((name) => JSON.parse(readFileSync(join(directory, name), "utf8")) as Shard);
}

/** The prose an adapter is actually served, used to check an answer is knowable from it. */
function prose(shard: Shard): string {
  const timeline = Array.isArray(shard.timeline) ? shard.timeline.join("\n") : shard.timeline ?? "";
  return `${shard.compiled_truth} ${timeline}`.toLowerCase();
}

function displayName(shard: Shard): string {
  return shard._facts.name ?? shard.title;
}

type Template = {
  /** Upstream's own question wording, unchanged. */
  question: (title: string) => string;
  linkTypes: string[];
  tag: string;
  /** The expected answers this template reads off a page's facts. */
  expected: (facts: Facts) => string[] | undefined;
};

/**
 * Upstream's four templates, in upstream's order. Founders are employees too, which is
 * why "who works at X" accepts both — their comment, and their behaviour.
 */
const TEMPLATES: Template[] = [
  {
    question: (title) => `Who attended ${title}?`,
    linkTypes: ["attended"],
    tag: "attended",
    expected: (facts) => (facts.type === "meeting" ? facts.attendees : undefined),
  },
  {
    question: (title) => `Who works at ${title}?`,
    linkTypes: ["works_at", "founded"],
    tag: "works-at",
    expected: (facts) => (facts.type === "company"
      ? [...new Set([...(facts.employees ?? []), ...(facts.founders ?? [])])]
      : undefined),
  },
  {
    question: (title) => `Who invested in ${title}?`,
    linkTypes: ["invested_in"],
    tag: "invested-in",
    expected: (facts) => (facts.type === "company" ? facts.investors : undefined),
  },
  {
    question: (title) => `Who advises ${title}?`,
    linkTypes: ["advises"],
    tag: "advises",
    expected: (facts) => (facts.type === "company" ? facts.advisors : undefined),
  },
];

export function deriveWorldQuestions(directory = corpusDirectory("world-v1")): QuestionSet {
  const shards = readShards(directory);
  const bySlug = new Map(shards.map((shard) => [shard.slug, shard]));
  const allProse = shards.map(prose);

  // Taken from the loader rather than recomputed, so the batch a question is due in can
  // never drift from the batch the reader actually serves that page in.
  const batchOf = new Map(loadWorldCorpus(directory).records.map((record) => [record.slug, record.batch]));
  const proseByBatch = shards.map((shard) => ({ batch: batchOf.get(shard.slug)!, text: prose(shard) }));

  const questions: PublicQuery[] = [];
  const answers: SealedAnswer[] = [];

  for (const template of TEMPLATES) {
    for (const shard of shards) {
      // Only entities with their own page can be expected answers. Upstream's generator
      // references some it never generated, and asking for those would fail any system.
      const expected = (template.expected(shard._facts) ?? []).filter((slug) => bySlug.has(slug));
      if (expected.length === 0) continue;

      const id = `q-${String(questions.length + 1).padStart(4, "0")}`;
      questions.push({
        id,
        // Relational and graph-required: upstream's own definition of the medium tier.
        tier: "medium",
        text: template.question(shard.title),
        expected_output_type: "answer-string",
        tags: ["relational", template.tag],
      });

      /**
       * An answer is knowable only if some page states the *relationship*, not merely the
       * name — every entity's own page names itself, so checking for the name alone would
       * call everything knowable.
       *
       * Both sides are matched on their **slug**, because that is the anchor upstream
       * actually writes: prose says "senior engineer at [Beta](companies/beta-1)" and
       * never "Beta - Cybersecurity Startup", which is the page title. Matching titles
       * reported three answers as unknowable that the corpus states plainly.
       *
       * Two ways a relationship is stated. On the seed page the subject is implicit,
       * because the page is about it, so naming the answer there is enough: "Mia Brown
       * led the session" on Acme's board-meeting page. Anywhere else both have to appear
       * together: "Adam Lopez is a senior engineer at [Delta](companies/delta-3)" on
       * Adam's own page answers who works at Delta.
       */
      const seedProse = prose(shard);
      const mentions = (text: string, slug: string): boolean =>
        text.includes(slug.toLowerCase()) || text.includes(displayName(bySlug.get(slug)!).toLowerCase());
      const unstated = expected.filter((slug) => {
        if (mentions(seedProse, slug)) return false;
        return !allProse.some((text) => mentions(text, slug) && mentions(text, shard.slug));
      }).map((slug) => displayName(bySlug.get(slug)!));

      /**
       * The batch by which every answer has become knowable.
       *
       * Two pages can state a relationship: the seed's, which names the answer directly
       * ("Mia Brown led the session"), or the answer's own, which names the seed ("Adam
       * Lopez is a senior engineer at [Delta](companies/delta-3)"). So an answer is
       * knowable once *either* has been served, and the question is due once every answer
       * is — never before the seed itself, since the question names it.
       *
       * Co-occurrence elsewhere deliberately does not count. An earlier version accepted
       * any page mentioning both, and a demo-day page naming Chris Smith alongside Acme
       * made "who works at Acme?" due eight batches before Chris Smith's page existed.
       * Appearing in the same room is not employment.
       */
      const dueBatch = expected.reduce((latest, slug) => {
        const onSeed = mentions(seedProse, slug) ? batchOf.get(shard.slug)! : undefined;
        const onOwn = mentions(prose(bySlug.get(slug)!), shard.slug) ? batchOf.get(slug)! : undefined;
        const knowable = [onSeed, onOwn].filter((batch): batch is string => batch !== undefined);
        // Neither states it, so the answer is only ever knowable once both pages exist.
        const earliest = knowable.sort()[0]
          ?? [batchOf.get(shard.slug)!, batchOf.get(slug)!].sort().at(-1)!;
        return earliest > latest ? earliest : latest;
      }, batchOf.get(shard.slug)!);

      const expectedNames = expected.map((slug) => displayName(bySlug.get(slug)!));
      // Upstream titles its one-on-ones `1:1 Wendy Hernandez + Mia Brown`, so "who
      // attended" hands over the answer. Flagged rather than dropped — see `SealedAnswer`.
      const questionText = template.question(shard.title);
      const selfAnswering = expectedNames.some((name) => questionText.includes(name));

      answers.push({
        id,
        relevant: expected,
        expected_names: expectedNames,
        seed: shard.slug,
        link_types: template.linkTypes,
        due_batch: dueBatch,
        ...(unstated.length ? { unstated_in_prose: unstated } : {}),
        ...(selfAnswering ? { self_answering: true } : {}),
      });
    }
  }

  return { corpusId: "world-v1", questions, answers };
}

/**
 * Every person the corpus can name.
 *
 * The scorer needs this to tell a confidently wrong attribution — naming someone who was
 * not at the meeting — from prose it simply does not recognise. Only people, because
 * every template asks "who": a company named as context is background, not an answer.
 */
export function worldPeopleNames(directory = corpusDirectory("world-v1")): string[] {
  return readShards(directory)
    .filter((shard) => shard._facts.type === "person")
    .map(displayName)
    .sort();
}
