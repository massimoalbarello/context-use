// Imported by path rather than by name: `eval/` is not a workspace package, so the bare
// specifier resolves only inside the container. The path resolves in both places, which
// keeps this file typechecked on the host even though it never runs there.
import {
  DirectoryRepository,
  PageRepository,
  createPool,
} from "../../packages/database/src/index.ts";
import { corpusDirectory } from "../../../runner/corpus/integrity.ts";
import { loadWorldCorpus } from "../corpus.ts";
import { planSeed } from "./seed.ts";

/**
 * Applies a seed plan, **inside the private-MCP container**.
 *
 * It runs there for two reasons. Postgres is not published on a host port, so the host
 * cannot open a pool at all; and the workspace packages only resolve where
 * `/app/node_modules` is mounted. Writing through `PageRepository` rather than raw SQL is
 * the point — the search vector, the link normalisation and the version row are production
 * behaviour, and a seeded page has to be indistinguishable from a written one or retrieval
 * would be measured against something the product never produces.
 *
 * `eval/` is absent from the production image and `EVAL_CORPUS_PATH` is rejected there by
 * the config boundary, so this file is unreachable outside development.
 *
 * Usage: bun /app/eval/data/world-v1/qa/seed-worker.ts <through-batch>
 */

const through = process.argv[2];
if (!through) throw new Error("Usage: seed-worker.ts <through-batch>");

const databaseUrl = process.env.MCP_DATABASE_URL;
if (!databaseUrl) throw new Error("MCP_DATABASE_URL is not set; this must run inside the private-mcp container.");

const records = loadWorldCorpus(corpusDirectory("world-v1")).records
  .filter((record) => record.batch <= through);
if (records.length === 0) throw new Error(`No world-v1 records at or before ${through}`);

const pool = createPool(databaseUrl, { application_name: "context-use-eval-seed" });
const pages = new PageRepository(pool);
const directories = new DirectoryRepository(pool);

// The same actor an MCP write carries, so nothing downstream can tell a seeded page from
// one the agent wrote.
const actor = { kind: "mcp", subject: "eval-seed" } as const;

// What the template already ships, so only genuinely missing folders are created.
const existing = await directories.list() as { current_path: string }[];
const plan = planSeed(records, existing.map((entry) => entry.current_path));

let createdDirectories = 0;
for (const directory of plan.directories) {
  try {
    await directories.create(directory);
    createdDirectories += 1;
  } catch (error) {
    // Already present is the normal case for the folders the template ships.
    if (!/duplicate key|already exists/i.test(String(error))) throw error;
  }
}

let createdPages = 0;
for (const page of plan.pages) {
  await pages.create(page, actor);
  createdPages += 1;
}

await pool.end();
console.log(JSON.stringify({ through, directories: createdDirectories, pages: createdPages }));
