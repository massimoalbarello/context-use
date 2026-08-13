import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { assembleCorpus, type Corpus, type CorpusRecord } from "../../runner/corpus/types.ts";

/**
 * Loads `world-v1`: 240 already-distilled biographical pages — 80 people, 80 companies,
 * 50 meetings, 30 concepts — one record per page.
 *
 * **`_facts` is stripped here and never leaves this file.** Every shard carries a
 * `_facts` block of canonical relationships, and that block is the answer key behind the
 * 145 questions in this eval package's `qa/`. The schema below declares only the five public fields,
 * so parsing drops `_facts` the way upstream's own `sanitizePage()` does, and a test
 * asserts no `_facts` value reaches a record body. Question derivation reads the shards
 * directly and deliberately; the serving path cannot.
 */

const PAGE_TYPES = ["person", "company", "meeting", "concept"] as const;

/** Upstream ships no manifest for this corpus; the repository is MIT throughout. */
const LICENSE = "MIT";

/**
 * Vendored verbatim but never served: generation cost metadata and a rendered explorer.
 * Neither is corpus content.
 */
const NOT_CONTENT = new Set(["_ledger.json", "world.html"]);

/** Pages per batch. 240 pages over 10 batches, comparable in size to one amara day. */
const BATCH_SIZE = 24;

/**
 * Only the fields an adapter may see. Zod drops everything else on parse, which is what
 * keeps `_facts` out of the serving path — the strip is the schema, not a later deletion
 * someone can forget to make.
 */
const publicPageSchema = z.object({
  slug: z.string().min(1),
  type: z.enum(PAGE_TYPES),
  title: z.string().min(1),
  compiled_truth: z.string().min(1),
  // 224 shards write the timeline as one string of bullet lines and 16 write the same
  // lines as an array — an upstream generator inconsistency, not two kinds of content.
  // Joining preserves the lines and their order exactly.
  timeline: z.union([z.string(), z.array(z.string())]).default("")
    .transform((value) => (Array.isArray(value) ? value.join("\n") : value)),
});

type PublicPage = z.infer<typeof publicPageSchema>;

/**
 * The page as prose. Upstream's inline `[Name](people/slug)` references are served
 * unchanged: they are upstream's own paths, and rewriting them would both modify the
 * corpus and disadvantage any system whose extraction is built to read them.
 */
function renderPage(page: PublicPage): string {
  const lines = [
    `# ${page.title}`,
    "",
    `**Type:** ${page.type}`,
    "",
    page.compiled_truth.trim(),
    ...(page.timeline.trim() ? ["", "## Timeline", "", page.timeline.trim()] : []),
  ];
  return `${lines.join("\n")}\n`;
}

export function loadWorldCorpus(directory: string): Corpus {
  const files = readdirSync(directory).sort()
    .filter((name) => name.endsWith(".json") && !NOT_CONTENT.has(name));

  const pages = files.map((name) => {
    const raw = JSON.parse(readFileSync(join(directory, name), "utf8")) as unknown;
    return publicPageSchema.parse(raw);
  });

  const slugs = new Set(pages.map((page) => page.slug));
  if (slugs.size !== pages.length) throw new Error("world-v1 holds duplicate page slugs");

  /**
   * A batch is a stride over the slug-sorted pages rather than a contiguous slice.
   *
   * Sorted by slug the corpus runs companies, concepts, meetings, then people, so
   * contiguous batches would serve every company before the people who work at them and
   * measure ordering rather than capability. Each type's count is a multiple of ten, so a
   * stride of ten gives every batch exactly 8 companies, 3 concepts, 5 meetings and 8
   * people — a proportional mix, the way an amara day holds a mix of sources.
   *
   * This is serving order, not corpus content: the vendored files are untouched, and the
   * order is fixed rather than shuffled so that two runs stay comparable.
   */
  const batchCount = Math.ceil(pages.length / BATCH_SIZE);
  const label = (index: number) => `batch-${String(index + 1).padStart(2, "0")}`;
  const records: CorpusRecord[] = pages.map((page, index) => ({
    slug: page.slug,
    type: page.type,
    batch: label(index % batchCount),
    markdown: renderPage(page),
    action: "added" as const,
    itemSlugs: [page.slug],
  }));

  // Served batch by batch, and in slug order within each batch.
  records.sort((left, right) => left.batch.localeCompare(right.batch)
    || left.slug.localeCompare(right.slug));

  if (records.length !== files.length) {
    throw new Error(`world-v1 pages were dropped rather than served: ${files.length} files, ${records.length} records`);
  }

  return assembleCorpus("world-v1", LICENSE, records);
}
