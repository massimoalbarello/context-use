import type { CorpusRecord } from "../../../runner/corpus/types.ts";

/**
 * The write shapes, declared structurally rather than imported.
 *
 * `eval/` is not a workspace package, so it cannot resolve `@context-use/shared` by name
 * on the host — only inside the container, where the seeding worker runs. Declaring them
 * here keeps this module loadable anywhere, and [seed.test.ts](seed.test.ts) validates
 * every generated write against the real production schemas so the two cannot drift.
 */
export type CreateDirectoryInput = { path: string; title: string; summary: string };
export type CreatePageInput = {
  path: string;
  title: string;
  summary: string;
  body_markdown: string;
  commit_message: string;
};

/**
 * Turns `world-v1` pages into knowledge-base writes, so retrieval can be measured on its
 * own.
 *
 * `world-v1` is seeded rather than distilled, and the reason is in the corpus: it has no
 * owner. Its 240 pages are third-person profiles of a VC world with no "me" at the centre —
 * twenty partners at twenty different firms, no person in more than four of fifty meetings.
 * The activity distiller selects on owner engagement, so on this corpus it correctly
 * imports almost nothing and the resulting score measures a mismatch rather than a system.
 *
 * Upstream never distils it either: `before-after.ts` calls `putPage` for all 240 pages
 * and then queries. The corpus *is* the knowledge base in their harness, and seeding it is
 * the step they perform too — which makes a later comparison closer rather than further.
 *
 * So this measures retrieval over upstream's page structure, and deliberately says nothing
 * about the distiller or about our own taxonomy. Those belong to `amara-life-v1`, which has
 * a real owner and real activity.
 */

/** The first sentence of the page, which is what a summary is for. */
export function summarise(markdown: string): string {
  const body = markdown
    .replace(/^#[^\n]*\n/, "")
    .replace(/^\*\*Type:\*\*[^\n]*\n/m, "")
    .trim();
  const firstSentence = /^(.+?[.!?])(\s|$)/s.exec(body)?.[1] ?? body;
  const single = firstSentence.replace(/\s+/g, " ").trim();
  // `KnowledgeSummary` is one line and at most 320 characters.
  return single.length <= 320 ? single : `${single.slice(0, 317).trimEnd()}…`;
}

function title(markdown: string): string {
  const heading = /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim() ?? "";
  // `title` is at most 240 characters; upstream's are far shorter, but bound it anyway.
  return heading.slice(0, 240);
}

export type SeedPlan = {
  /** Directories to create before the pages, parents first. */
  directories: CreateDirectoryInput[];
  pages: CreatePageInput[];
};

/** Sentence case for a directory title: `concepts` reads better as `Concepts`. */
function directoryTitle(path: string): string {
  const leaf = path.split("/").at(-1)!;
  return leaf.charAt(0).toUpperCase() + leaf.slice(1).replace(/[-_]/g, " ");
}

/**
 * Builds the writes for a set of corpus records.
 *
 * Pages keep **upstream's own slug** as their path — `people/adam-lee-19` rather than a
 * path of our choosing. That is what makes `Gold.relevant` meaningful later: a retrieval
 * comparison scores the slugs upstream already labelled, and renaming them here would
 * throw that away for no gain.
 *
 * `existingDirectories` is what the default template already ships, so only what is
 * genuinely missing gets created — `concepts/` is the one `world-v1` needs and the
 * template does not have.
 */
export function planSeed(records: CorpusRecord[], existingDirectories: string[] = []): SeedPlan {
  const have = new Set(existingDirectories);
  const wanted = new Set<string>();

  for (const record of records) {
    const segments = record.slug.split("/");
    // Every ancestor, because `parent_path` is a generated column with a foreign key:
    // a page cannot exist until the directory holding it does.
    for (let depth = 1; depth < segments.length; depth += 1) {
      const path = segments.slice(0, depth).join("/");
      if (!have.has(path)) wanted.add(path);
    }
  }

  const directories = [...wanted]
    // Parents first, so each create finds its own parent already present.
    .sort((left, right) => left.split("/").length - right.split("/").length || left.localeCompare(right))
    .map((path) => ({
      path,
      title: directoryTitle(path),
      summary: `Pages seeded verbatim from the ${path} section of the world-v1 corpus.`,
    }));

  const pages = records.map((record) => ({
    path: record.slug,
    title: title(record.markdown) || record.slug,
    summary: summarise(record.markdown),
    body_markdown: record.markdown,
    commit_message: `Seed ${record.slug} from world-v1`,
  }));

  return { directories, pages };
}
