import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CORPUS_DIRECTORY } from "../corpus-integrity.ts";
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
