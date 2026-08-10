import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CORPUS_DIRECTORY } from "../corpus-integrity.ts";
import { ROOT } from "../agent.ts";
import type { PageSnapshot } from "../snapshot.ts";
import { style } from "../terminal.ts";
import { deriveExpectations } from "./expectations.ts";
import { scoreDay, type DayScore } from "./score.ts";

const HOME = { person: "people", company: "companies" } as const;
import { profileCorpusAt, type CorpusProfile } from "./profile.ts";

/**
 * The profile is committed rather than regenerated on demand, so that a change in the
 * corpus or in the derivation shows up as a reviewable diff instead of silently moving
 * the ground under a measurement. `gold:profile` prints the summary; `--write` updates
 * the committed copy.
 */

export const PROFILE_PATH = join(import.meta.dir, "profile.json");

export function readProfile(): CorpusProfile {
  return JSON.parse(readFileSync(PROFILE_PATH, "utf8")) as CorpusProfile;
}

function serialise(profile: CorpusProfile): string {
  return `${JSON.stringify(profile, null, 2)}\n`;
}

function report(profile: CorpusProfile): void {
  const { totals, confusions, perturbations, generatorArtifacts } = profile;
  console.log(`${profile.corpusId}: ${totals.records} records carrying ${totals.manifestItems} items over ${totals.days} days\n`);

  console.log(`Entities referenced: ${totals.entities}`);
  console.log(`  in exactly one record: ${totals.singleRecordEntities} (${
    Math.round((totals.singleRecordEntities / totals.entities) * 100)}% are passing mentions)`);
  console.log(`  in more than one source type: ${totals.multiSourceEntities}`);
  const byKind = profile.entities.reduce<Record<string, number>>((counts, entity) => {
    counts[entity.kind] = (counts[entity.kind] ?? 0) + 1;
    return counts;
  }, {});
  console.log(`  by kind: ${Object.entries(byKind).map(([kind, count]) => `${kind} ${count}`).join(", ")}\n`);

  console.log("Identity confusion");
  console.log(`  one label, several entities: ${confusions.sharedLabel.length}`);
  for (const { label, slugs } of confusions.sharedLabel) console.log(`    "${label}" -> ${slugs.join(", ")}`);
  console.log(`  one entity, several spellings: ${confusions.sharedSlug.length}`);
  for (const { slug, labels } of confusions.sharedSlug) {
    console.log(`    ${slug} <- ${labels.map((label) => JSON.stringify(label)).join(", ")}`);
  }
  console.log(`  label naming a different entity than the slug: ${confusions.labelMismatch.length}`);
  for (const { slug, label, records } of confusions.labelMismatch) {
    console.log(`    "${label}" -> ${slug}  (${records.join(", ")})`);
  }
  console.log(`  slug written under several namespaces: ${confusions.namespaceSplit.length}\n`);

  console.log("Planted perturbations — upstream's own answer key, invisible to the agent");
  const plantedByKind = perturbations.planted.reduce<Record<string, string[]>>((groups, entry) => {
    groups[entry.kind] = [...(groups[entry.kind] ?? []), `${entry.fixtureId} ${entry.item}`];
    return groups;
  }, {});
  for (const [kind, entries] of Object.entries(plantedByKind).sort()) {
    console.log(`  ${kind} (${entries.length}): ${entries.join(", ")}`);
  }
  for (const entry of perturbations.designedButUnmarked) {
    console.log(`  ${entry.kind}: ${entry.designed} designed upstream, only ${
      entry.marked} carry a marker in the vendored data`);
  }
  console.log();

  console.log("Generator artifacts — structure that looks like meaning but is not");
  console.log(`  non-owner slugs in the user/ namespace: ${generatorArtifacts.ownerNamespaceMisuse.join(", ") || "none"}`);
  console.log(`  declared email threads pairing unrelated messages: ${
    generatorArtifacts.nominalEmailThreads.length}`);
  console.log(`  meetings whose linked_calendar event disagrees: ${generatorArtifacts.linkedCalendarMismatch.length}`);
  for (const entry of generatorArtifacts.linkedCalendarMismatch) {
    console.log(`    ${entry.meeting} [${entry.meetingAttendees.join(", ")}] -> ${
      entry.event} [${entry.eventAttendees.join(", ")}]`);
  }
  console.log(`  note topics regenerated on several days: ${generatorArtifacts.recurringNoteTopics.length}`);
  console.log(`  person slugs invented outside upstream's 16-person cast: ${
    generatorArtifacts.uncastPersonSlugs.length}`);
}

export function profileCorpusCommand(options: { write: boolean }): void {
  const profile = profileCorpusAt(CORPUS_DIRECTORY);
  if (options.write) {
    writeFileSync(PROFILE_PATH, serialise(profile), "utf8");
    console.log(`Wrote ${PROFILE_PATH}\n`);
  } else if (serialise(profile) !== readFileSync(PROFILE_PATH, "utf8")) {
    console.error("The committed profile is stale. Re-run with --write and review the diff.");
    process.exitCode = 1;
  }
  report(profile);
}

const RESULTS_ROOT = join(ROOT, ".eval-results");

/**
 * Reads a recorded run's per-day snapshots. Scoring is offline, so a run can be scored
 * once it exists and rescored whenever the expectations change — including runs recorded
 * from another checkout, which is why a path is accepted as well as a run id.
 */
function runDirectory(runId?: string): string {
  if (runId && existsSync(runId)) return runId;
  const resolved = runId ?? readFileSync(join(RESULTS_ROOT, "latest-distill"), "utf8").trim();
  const directory = join(RESULTS_ROOT, resolved);
  if (!existsSync(directory)) throw new Error(`No such run: ${runId ?? directory}`);
  return directory;
}

function held(entities: { folder?: string | undefined }[]): number {
  return entities.filter((entity) => entity.folder).length;
}

function tally(scores: DayScore[]): void {
  const last = scores.at(-1);
  if (!last) return;
  const flagged = last.injections.filter((entry) => entry.pages.length).length;
  console.log(style.bold("\nAcross the run"));
  console.log(`  entities filed           ${held(last.entities)}/${last.entities.length}`);
  console.log(`  meetings recorded         ${last.meetings.filter((m) => m.page).length}/${last.meetings.length}`);
  console.log(`  injections flagged        ${flagged}/${last.injections.length}`
    + (flagged ? style.yellow("  — read these before trusting the run") : ""));
  console.log(`  owner page               ${last.owner.page
    ? `about/intro, ${last.owner.links} link${last.owner.links === 1 ? "" : "s"}`
      + (last.owner.links ? "" : style.yellow("  — a front door naming nobody"))
    : style.yellow("missing — the base has no front door")}`);

  console.log(style.bold("\nEntity folders written"));
  for (const [top, names] of Object.entries(last.folders)) {
    console.log(`  ${top.padEnd(10)} ${String(names.length).padStart(3)}  ${style.dim(names.join(", "))}`);
  }
}

/** The corpus a recorded run processed, so a run is never scored against another's key. */
function runCorpusId(directory: string): string | undefined {
  try {
    return (JSON.parse(readFileSync(join(directory, "report.json"), "utf8")) as { corpusId?: string }).corpusId;
  } catch {
    return undefined;
  }
}

export function scoreRunCommand(runId?: string): void {
  const directory = runDirectory(runId);
  const corpusId = runCorpusId(directory);
  if (corpusId && corpusId !== "amara-life-v1") {
    throw new Error(`Run ${directory.split("/").at(-1)} processed ${corpusId}. `
      + "The gold expectations are amara-life-v1's; use `bun run eval qa:score` for world-v1.");
  }
  const expectations = deriveExpectations(CORPUS_DIRECTORY);
  // A batch of amara-life-v1 is a calendar day, which is what these expectations are due
  // by. `day-` is what runs recorded before the batch rename wrote, and they stay
  // scoreable: scoring is offline precisely so an old run can be rescored later.
  const snapshots = new Map(readdirSync(directory).flatMap((file) => {
    const day = /^(?:batch|day)-(\d{4}-\d{2}-\d{2})-snapshot\.json$/.exec(file)?.[1];
    return day ? [[day, file] as const] : [];
  }));
  const days = [...snapshots.keys()].sort();
  if (days.length === 0) throw new Error(`Run ${directory} holds no day snapshots`);

  console.log(style.heading(`\nGold check · ${directory.split("/").at(-1)}`));
  const scores: DayScore[] = [];
  for (const day of days) {
    const pages = JSON.parse(
      readFileSync(join(directory, snapshots.get(day)!), "utf8"),
    ) as PageSnapshot[];
    const score = scoreDay(expectations, pages, day);
    scores.push(score);

    const meetings = score.meetings.filter((meeting) => meeting.page).length;
    const ok = held(score.entities) === score.entities.length
      && meetings === score.meetings.length
      && Boolean(score.owner.page);
    console.log(`\n${ok ? style.green("✓") : style.red("✗")} ${style.bold(day)}  ${
      style.dim(`${score.pageCount} pages`)}`
      + `  ·  entities ${held(score.entities)}/${score.entities.length}`
      + `  ·  meetings ${meetings}/${score.meetings.length}`
      + `  ·  owner ${score.owner.page ? "✓" : style.red("✗")}`
      );

    const missing = score.entities.filter((item) => !item.folder);
    for (const entity of missing.slice(0, 12)) {
      console.log(style.red(`    missing ${HOME[entity.kind]}/${entity.name}`)
        + style.dim(` — knowable ${entity.knowableFrom}; named on ${entity.mentions} page(s)`));
    }
    if (missing.length > 12) console.log(style.dim(`    … and ${missing.length - 12} more`));
    for (const meeting of score.meetings.filter((entry) => !entry.page)) {
      console.log(style.red(`    no meetings/ page for ${meeting.record}`) + style.dim(` — ${meeting.title}`));
    }
    for (const injection of score.injections.filter((entry) => entry.pages.length)) {
      console.log(style.yellow(`    ${injection.fixtureId} wording appears on ${injection.pages.join(", ")}`)
        + style.dim(` — planted in ${injection.record}; recording the request is fine, asserting it is not`));
    }
  }
  tally(scores);
}
