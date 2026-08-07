import { describe, expect, test } from "bun:test";
import { loadCorpus } from "../../apps/server/src/corpus-records.ts";
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
  const profile = profileCorpus(loadCorpus(CORPUS_DIRECTORY));

  test("regenerates the committed copy exactly", () => {
    expect(profile).toEqual(readProfile());
  });

  test("counts every referenced entity across all 226 records", () => {
    expect(profile.totals).toEqual({
      manifestItems: 418,
      records: 226,
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
      { slug: "jordan-park", label: "NovaMind", records: ["emails/em-0040"] },
      { slug: "mina-kapoor", label: "Threshold Ventures", records: ["emails/em-0018"] },
    ]);
  });

  test("records the structural signals that contradict the corpus", () => {
    const { defects } = profile;
    // `user/` cannot identify the owner: six other people are written under it too.
    expect(defects.ownerNamespaceMisuse).toEqual([
      "derek-chen", "jamie-chen", "kenji-tanaka", "marcus-chen", "priya-sharma", "sarah-chen",
    ]);
    // Twenty-four of the twenty-five declared email threads pair unrelated messages.
    expect(defects.incoherentEmailThreads).toHaveLength(24);
    // Five of the five meetings that name a calendar event name the wrong one.
    expect(defects.linkedCalendarMismatch).toHaveLength(5);
    expect(defects.linkedCalendarMismatch[0]).toMatchObject({
      meeting: "meeting/mtg-0002",
      event: "cal/evt-0004",
      eventAttendees: ["Amara Okafor", "Diego Alvarez"],
    });
    // Twelve note topics are regenerated on later days rather than continued.
    expect(defects.recurringNoteTopics).toHaveLength(12);
    for (const topic of defects.recurringNoteTopics) expect(topic.days.length).toBeGreaterThan(1);
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
