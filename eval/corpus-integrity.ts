import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * File-level integrity for the vendored corpus.
 *
 * `loadCorpus` already checks every note and meeting against the upstream manifest's own
 * `content_sha256`. Emails, Slack messages and calendar events are many items inside one
 * file and upstream hashes them per item under an undocumented scheme, so this lockfile
 * covers the vendored files themselves. Together they leave no unverified bytes.
 */

export const CORPUS_ROOT = join(import.meta.dir, "corpus");
export const CORPUS_DIRECTORY = join(CORPUS_ROOT, "amara-life-v1");
export const CORPUS_LOCK_PATH = join(CORPUS_ROOT, "corpus.lock.json");

export const CORPUS_UPSTREAM = {
  repository: "garrytan/gbrain-evals",
  commit: "565b80754ffa6abb9afb041026f2fab048aa7553",
  path: "eval/data/amara-life-v1",
} as const;

export type CorpusLock = {
  upstream: typeof CORPUS_UPSTREAM;
  files: Record<string, string>;
};

function walk(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory).sort()) {
    const absolute = join(directory, entry);
    if (statSync(absolute).isDirectory()) walk(absolute, found);
    else found.push(absolute);
  }
  return found;
}

export function hashCorpusFiles(directory: string = CORPUS_DIRECTORY): Record<string, string> {
  const files: Record<string, string> = {};
  for (const absolute of walk(directory)) {
    files[relative(directory, absolute)] = createHash("sha256")
      .update(readFileSync(absolute))
      .digest("hex");
  }
  return files;
}

export function readCorpusLock(path: string = CORPUS_LOCK_PATH): CorpusLock {
  return JSON.parse(readFileSync(path, "utf8")) as CorpusLock;
}

export type CorpusDifference = {
  changed: string[];
  missing: string[];
  unexpected: string[];
};

export function diffCorpus(
  lock: CorpusLock = readCorpusLock(),
  actual: Record<string, string> = hashCorpusFiles(),
): CorpusDifference {
  const changed: string[] = [];
  const missing: string[] = [];
  for (const [path, digest] of Object.entries(lock.files)) {
    if (!(path in actual)) missing.push(path);
    else if (actual[path] !== digest) changed.push(path);
  }
  const unexpected = Object.keys(actual).filter((path) => !(path in lock.files));
  return { changed: changed.sort(), missing: missing.sort(), unexpected: unexpected.sort() };
}

export function corpusIsUnchanged(difference: CorpusDifference): boolean {
  return difference.changed.length === 0
    && difference.missing.length === 0
    && difference.unexpected.length === 0;
}
