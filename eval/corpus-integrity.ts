import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";

/**
 * File-level integrity for the vendored corpora.
 *
 * Each corpus is copied verbatim from a pinned upstream commit and never edited, so every
 * byte under `corpus/<id>/` is covered by `corpus/<id>.lock.json`. Where upstream ships
 * its own per-item hashes the loader checks those too, and the two together leave nothing
 * unverified: for `amara-life-v1` the manifest proves the vendored notes and meetings are
 * upstream's, and the lockfile proves nothing has changed since vendoring.
 */

export const CORPUS_IDS = ["amara-life-v1", "world-v1"] as const;
export type CorpusId = (typeof CORPUS_IDS)[number];

/** The corpus a run processes unless one is named. */
export const DEFAULT_CORPUS_ID: CorpusId = "amara-life-v1";

export const CORPUS_ROOT = join(import.meta.dir, "corpus");

export type CorpusUpstream = {
  repository: string;
  commit: string;
  path: string;
};

/**
 * Both corpora come from the same upstream commit. Pinning them separately anyway is
 * deliberate: they are independent experiments and re-pinning one must not silently
 * move the other.
 */
export const CORPUS_UPSTREAM: Record<CorpusId, CorpusUpstream> = {
  "amara-life-v1": {
    repository: "garrytan/gbrain-evals",
    commit: "565b80754ffa6abb9afb041026f2fab048aa7553",
    path: "eval/data/amara-life-v1",
  },
  "world-v1": {
    repository: "garrytan/gbrain-evals",
    commit: "565b80754ffa6abb9afb041026f2fab048aa7553",
    path: "eval/data/world-v1",
  },
};

export function isCorpusId(value: string): value is CorpusId {
  return (CORPUS_IDS as readonly string[]).includes(value);
}

export function corpusDirectory(id: CorpusId): string {
  return join(CORPUS_ROOT, id);
}

export function corpusLockPath(id: CorpusId): string {
  return join(CORPUS_ROOT, `${id}.lock.json`);
}

/**
 * The corpus a directory holds, from its own name.
 *
 * `EVAL_CORPUS_PATH` names a directory rather than a corpus, so this is how a path
 * turns back into the identifier the harness and the loader both key on.
 */
export function corpusIdAt(directory: string): CorpusId {
  const name = basename(directory.replace(/\/+$/, ""));
  if (!isCorpusId(name)) {
    throw new Error(`${directory} is not a vendored corpus. Expected one of: ${CORPUS_IDS.join(", ")}`);
  }
  return name;
}

/** Kept for the amara-keyed gold expectations, which are about that corpus by nature. */
export const CORPUS_DIRECTORY = corpusDirectory("amara-life-v1");

export type CorpusLock = {
  upstream: CorpusUpstream;
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

export function hashCorpusFiles(id: CorpusId = DEFAULT_CORPUS_ID): Record<string, string> {
  const directory = corpusDirectory(id);
  const files: Record<string, string> = {};
  for (const absolute of walk(directory)) {
    files[relative(directory, absolute)] = createHash("sha256")
      .update(readFileSync(absolute))
      .digest("hex");
  }
  return files;
}

export function readCorpusLock(id: CorpusId = DEFAULT_CORPUS_ID): CorpusLock {
  return JSON.parse(readFileSync(corpusLockPath(id), "utf8")) as CorpusLock;
}

export type CorpusDifference = {
  changed: string[];
  missing: string[];
  unexpected: string[];
};

export function diffCorpus(id: CorpusId = DEFAULT_CORPUS_ID): CorpusDifference {
  const lock = readCorpusLock(id);
  const actual = hashCorpusFiles(id);
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
