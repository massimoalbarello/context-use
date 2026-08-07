import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { loadCorpus } from "../apps/server/src/corpus-records.ts";
import {
  CORPUS_DIRECTORY,
  CORPUS_UPSTREAM,
  corpusIsUnchanged,
  diffCorpus,
  hashCorpusFiles,
} from "./corpus-integrity.ts";

/** Operator commands for the vendored corpus. Neither one rewrites it. */

export function verifyCorpus(): void {
  const difference = diffCorpus();
  if (!corpusIsUnchanged(difference)) {
    console.error("The vendored corpus differs from corpus.lock.json:");
    for (const path of difference.changed) console.error(`  changed     ${path}`);
    for (const path of difference.missing) console.error(`  missing     ${path}`);
    for (const path of difference.unexpected) console.error(`  unexpected  ${path}`);
    process.exit(1);
  }
  const corpus = loadCorpus(CORPUS_DIRECTORY);
  console.log(`${corpus.corpusId}: ${Object.keys(hashCorpusFiles()).length} files, ${
    corpus.records.length} items over ${corpus.days.length} days — unchanged.`);
  console.log(`Upstream ${CORPUS_UPSTREAM.repository}@${CORPUS_UPSTREAM.commit.slice(0, 12)}`);
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
 * difference. It never writes to the working copy: re-pinning the corpus invalidates
 * every score measured against the previous one, so it has to be a deliberate commit.
 */
export async function refreshCorpus(): Promise<void> {
  const work = mkdtempSync(join(tmpdir(), "corpus-refresh-"));
  try {
    const archive = join(work, "upstream.tar.gz");
    const download = Bun.spawnSync([
      "gh", "api", `repos/${CORPUS_UPSTREAM.repository}/tarball/${CORPUS_UPSTREAM.commit}`,
    ], { stdout: "pipe", stderr: "pipe" });
    if (download.exitCode !== 0) {
      throw new Error(`Could not download the upstream corpus:\n${download.stderr.toString()}`);
    }
    await Bun.write(archive, download.stdout);

    const list = Bun.spawnSync(["tar", "-tzf", archive], { stdout: "pipe", stderr: "pipe" });
    const archiveRoot = list.stdout.toString().split("\n")[0]?.split("/")[0];
    if (!archiveRoot) throw new Error("The upstream archive is empty");
    const extract = Bun.spawnSync([
      "tar", "-xzf", archive, "-C", work, `${archiveRoot}/${CORPUS_UPSTREAM.path}`,
    ], { stdout: "pipe", stderr: "pipe" });
    if (extract.exitCode !== 0) {
      throw new Error(`Could not extract the upstream corpus:\n${extract.stderr.toString()}`);
    }

    const upstream = filesUnder(join(work, archiveRoot, CORPUS_UPSTREAM.path));
    const local = filesUnder(CORPUS_DIRECTORY);
    const differences: string[] = [];
    for (const [path, digest] of upstream) {
      if (!local.has(path)) differences.push(`  missing locally  ${path}`);
      else if (local.get(path) !== digest) differences.push(`  differs          ${path}`);
    }
    for (const path of local.keys()) {
      if (!upstream.has(path)) differences.push(`  extra locally    ${path}`);
    }

    console.log(`Upstream ${CORPUS_UPSTREAM.repository}@${CORPUS_UPSTREAM.commit.slice(0, 12)}`);
    if (differences.length === 0) {
      console.log(`The vendored corpus matches upstream exactly (${upstream.size} files).`);
      return;
    }
    console.error("The vendored corpus differs from the pinned upstream commit:");
    for (const line of differences) console.error(line);
    console.error("\nRe-pin deliberately: copy the files in, regenerate corpus.lock.json, and commit.");
    process.exit(1);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
