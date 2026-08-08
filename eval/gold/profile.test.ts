import { describe, expect, test } from "bun:test";
import { loadCorpus } from "../corpus-records.ts";
import { CORPUS_DIRECTORY } from "../corpus-integrity.ts";
import { readProfile } from "./commands.ts";
import { profileCorpus } from "./profile.ts";

/**
 * The committed profile is the evidence every later stage of the gold standard argues
 * from, so it has to stay derivable from the corpus bytes rather than drift into a
 * hand-maintained document. The spot assertions below pin the specific corpus facts
 * that shape the design: identity is ambiguous, most entities are passing mentions, and
 * several structural signals contradict the corpus's own contents.
 */
describe("corpus profile", () => {
  const profile = profileCorpus(loadCorpus(CORPUS_DIRECTORY), CORPUS_DIRECTORY);

  test("regenerates the committed copy exactly", () => {
    expect(profile).toEqual(readProfile());
  });

  test("counts every referenced entity across all 418 records", () => {
    expect(profile.totals).toEqual({
      manifestItems: 418,
      records: 418,
      days: 47,
      entities: 176,
      singleRecordEntities: 130,
      multiSourceEntities: 25,
    });
  });

  test("finds the surface labels that stand for more than one entity", () => {
    const shared = new Map(profile.confusions.sharedLabel.map((entry) => [entry.label, entry.slugs]));
    // Three different people are called just "Priya" and four just "Derek". A knowledge
    // base that merges on the surface label gets these wrong; the slug is the answer key.
    expect(shared.get("priya")).toEqual(["priya-anand", "priya-patel", "priya-sharma"]);
    expect(shared.get("derek")).toEqual(["derek-chen", "derek-huang", "derek-lin", "derek-zhang"]);
    expect(shared.get("meridian")).toEqual(["meridian", "meridian-health", "meridian-robotics"]);
  });

  test("finds the one entity written four different ways", () => {
    const novamind = profile.confusions.sharedSlug.find((entry) => entry.slug === "novamind");
    // Including a zero-width space inside one of them, which normalisation has to survive.
    expect(novamind?.labels).toEqual(["NovaMind", "NovaMinds", "NovaM\u200bind", "Novamind"]);
  });

  test("finds the references whose label names something other than the slug", () => {
    expect(profile.confusions.labelMismatch).toEqual([
      { slug: "jordan-park", label: "NovaMind", records: ["emails/em-0041"] },
      { slug: "mina-kapoor", label: "Threshold Ventures", records: ["emails/em-0018"] },
    ]);
  });

  test("carries upstream's planted perturbations as an answer key", () => {
    const { planted, designedButUnmarked } = profile.perturbations;
    expect(planted).toHaveLength(10);
    // Five prompt injections: three by email, two in Slack, all inside the dense window.
    const poison = planted.filter((entry) => entry.kind === "poison");
    expect(poison.map((entry) => entry.item)).toEqual([
      "emails/em-0029", "emails/em-0033", "emails/em-0044", "slack/sl-0178", "slack/sl-0245",
    ]);
    for (const entry of planted) expect(entry.day >= "2026-04-13").toBe(true);
    // Upstream designed twenty perturbations but only ten survived into the vendored
    // data: meeting and note front matter has no field to carry the marker.
    expect(designedButUnmarked).toEqual([
      { kind: "contradiction", designed: 10, marked: 3 },
      { kind: "implicit-preference", designed: 3, marked: 0 },
      { kind: "stale-fact", designed: 5, marked: 2 },
    ]);
  });

  test("never leaks a perturbation marker into a record body", () => {
    // The markers are the answer key. They live in the JSONL envelope and the renderer
    // must not copy them, or the system under test can read the answer.
    for (const record of loadCorpus(CORPUS_DIRECTORY).records) {
      expect(record.markdown).not.toMatch(/perturbation|fixture_id|poison-\d|c-\d{3}|s-\d{3}/);
    }
  });

  test("separates generator artifacts from signal", () => {
    const artifacts = profile.generatorArtifacts;
    // `user/` cannot identify the owner: six other people are written under it too.
    expect(artifacts.ownerNamespaceMisuse).toEqual([
      "derek-chen", "jamie-chen", "kenji-tanaka", "marcus-chen", "priya-sharma", "sarah-chen",
    ]);
    // `thread_id` is floor(index / 2): 24 of 25 declared threads pair unrelated messages.
    expect(artifacts.nominalEmailThreads).toHaveLength(24);
    // `linked_calendar` is `cal/evt-{index * 2}`, so all five that exist point elsewhere.
    expect(artifacts.linkedCalendarMismatch).toHaveLength(5);
    expect(artifacts.linkedCalendarMismatch[0]).toMatchObject({
      meeting: "meeting/mtg-0002",
      event: "cal/evt-0004",
      eventAttendees: ["Amara Okafor", "Diego Alvarez"],
    });
    // Note topics cycle through twelve hints, each regenerated rather than continued.
    expect(artifacts.recurringNoteTopics).toHaveLength(12);
    for (const topic of artifacts.recurringNoteTopics) expect(topic.days.length).toBeGreaterThan(1);
    // Upstream designed a cast of sixteen; the prose generator invented thirty-seven more.
    expect(artifacts.uncastPersonSlugs).toHaveLength(37);
    expect(artifacts.uncastPersonSlugs).toContain("priya-sharma");
    expect(artifacts.uncastPersonSlugs).not.toContain("priya-patel");
  });

  test("keeps every entity traceable to the records that mention it", () => {
    const records = new Set(loadCorpus(CORPUS_DIRECTORY).records.map((record) => record.slug));
    for (const entity of profile.entities) {
      expect(entity.records.length).toBeGreaterThan(0);
      for (const record of entity.records) expect(records.has(record)).toBe(true);
      expect(entity.firstDay <= entity.lastDay).toBe(true);
      expect(entity.mentions).toBeGreaterThanOrEqual(entity.records.length);
    }
  });
});
