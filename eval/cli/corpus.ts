import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { loadCorpus } from "../runner/corpus/records.ts";
import {
  CORPUS_UPSTREAM,
  corpusDirectory,
  corpusIsUnchanged,
  diffCorpus,
  hashCorpusFiles,
  type CorpusId,
} from "../runner/corpus/integrity.ts";

/** Operator commands for the vendored corpora. Neither one rewrites them. */

export function verifyCorpus(id: CorpusId): void {
  const difference = diffCorpus(id);
  if (!corpusIsUnchanged(difference)) {
    console.error(`The vendored ${id} corpus differs from its corpus.lock.json:`);
    for (const path of difference.changed) console.error(`  changed     ${path}`);
    for (const path of difference.missing) console.error(`  missing     ${path}`);
    for (const path of difference.unexpected) console.error(`  unexpected  ${path}`);
    process.exit(1);
  }
  const corpus = loadCorpus(corpusDirectory(id));
  const span = corpus.days.length ? `${corpus.days.length} days` : `${corpus.batches.length} batches`;
  console.log(`${corpus.corpusId}: ${Object.keys(hashCorpusFiles(id)).length} files, ${
    corpus.records.length} records over ${span} — unchanged.`);
  const upstream = CORPUS_UPSTREAM[id];
  console.log(`Upstream ${upstream.repository}@${upstream.commit.slice(0, 12)} ${upstream.path}`);
}

function filesUnder(directory: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (current: string): void => {
    for (const entry of readdirSync(current).sort()) {
      const absolute = join(current, entry);
      if (statSync(absolute).isDirectory()) walk(absolute);
      else files.set(relative(directory, absolute), createHash("sha256").update(readFileSync(absolute)).digest("hex"));
    }
  };
  walk(directory);
  return files;
}

/**
 * Re-extracts the pinned upstream commit into a temporary directory and reports any
 * difference. It never writes to the working copy: re-pinning a corpus invalidates
 * every score measured against the previous one, so it has to be a deliberate commit.
 */
export async function refreshCorpus(id: CorpusId): Promise<void> {
  const upstream = CORPUS_UPSTREAM[id];
  const work = mkdtempSync(join(tmpdir(), "corpus-refresh-"));
  try {
    const archive = join(work, "upstream.tar.gz");
    const download = Bun.spawnSync([
      "gh", "api", `repos/${upstream.repository}/tarball/${upstream.commit}`,
    ], { stdout: "pipe", stderr: "pipe" });
    if (download.exitCode !== 0) {
      throw new Error(`Could not download the upstream corpus:\n${download.stderr.toString()}`);
    }
    await Bun.write(archive, download.stdout);

    const list = Bun.spawnSync(["tar", "-tzf", archive], { stdout: "pipe", stderr: "pipe" });
    const archiveRoot = list.stdout.toString().split("\n")[0]?.split("/")[0];
    if (!archiveRoot) throw new Error("The upstream archive is empty");
    const extract = Bun.spawnSync([
      "tar", "-xzf", archive, "-C", work, `${archiveRoot}/${upstream.path}`,
    ], { stdout: "pipe", stderr: "pipe" });
    if (extract.exitCode !== 0) {
      throw new Error(`Could not extract the upstream corpus:\n${extract.stderr.toString()}`);
    }

    const extracted = filesUnder(join(work, archiveRoot, upstream.path));
    const local = filesUnder(corpusDirectory(id));
    const differences: string[] = [];
    for (const [path, digest] of extracted) {
      if (!local.has(path)) differences.push(`  missing locally  ${path}`);
      else if (local.get(path) !== digest) differences.push(`  differs          ${path}`);
    }
    for (const path of local.keys()) {
      if (!extracted.has(path)) differences.push(`  extra locally    ${path}`);
    }

    console.log(`Upstream ${upstream.repository}@${upstream.commit.slice(0, 12)} ${upstream.path}`);
    if (differences.length === 0) {
      console.log(`The vendored ${id} corpus matches upstream exactly (${extracted.size} files).`);
      return;
    }
    console.error(`The vendored ${id} corpus differs from the pinned upstream commit:`);
    for (const line of differences) console.error(line);
    console.error("\nRe-pin deliberately: copy the files in, regenerate corpus.lock.json, and commit.");
    process.exit(1);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
