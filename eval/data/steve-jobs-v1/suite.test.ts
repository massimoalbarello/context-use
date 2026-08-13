import { describe, expect, test } from "bun:test";
import { renderStoryTurn } from "../../runner/story/runner.ts";
import { steveJobsV1 } from "./suite.ts";

function expectationReferences(expectation: (typeof steveJobsV1.stories)[number]["turns"][number]["expect"][number]): string[] {
  if (expectation.kind === "exists" || expectation.kind === "created"
    || expectation.kind === "updated" || expectation.kind === "unique"
    || expectation.kind === "view" || expectation.kind === "fact"
    || expectation.kind === "timeline") {
    return [expectation.subject, ...(expectation.kind === "timeline" && expectation.occurrence
      ? [expectation.occurrence] : [])];
  }
  if (expectation.kind === "linked" || expectation.kind === "relationship") {
    return [expectation.from, expectation.to];
  }
  return [];
}

describe("steve-jobs-v1 fixture integrity", () => {
  test("has unique stories and one isolated implicit-trigger probe", () => {
    const ids = steveJobsV1.stories.map((story) => story.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(steveJobsV1.stories.filter((story) => story.conversationPrelude === null)
      .map((story) => story.id)).toEqual(["implicit-write-trigger"]);
    expect(steveJobsV1.journey).not.toContain("implicit-write-trigger");
  });

  test("every subject reference resolves inside its story", () => {
    for (const story of steveJobsV1.stories) {
      const subjects = new Set(Object.keys(story.subjects));
      for (const definition of Object.values(story.subjects)) {
        for (const reference of [
          ...(definition.participants ?? []),
          ...(definition.organizations ?? []),
          ...(definition.about ?? []),
        ]) expect(subjects.has(reference), `${story.id} subject reference ${reference}`).toBe(true);
      }
      for (const turn of story.turns) {
        for (const expectation of turn.expect) {
          for (const reference of expectationReferences(expectation)) {
            expect(subjects.has(reference), `${story.id}/${turn.id} expectation reference ${reference}`).toBe(true);
          }
        }
      }
    }
  });

  test("journey contains each historical story once and in chronological order", () => {
    const historical = steveJobsV1.stories
      .filter((story) => story.id !== "implicit-write-trigger")
      .map((story) => story.id);
    expect(steveJobsV1.journey).toEqual(historical);
    const dates = steveJobsV1.journey.map((id) =>
      steveJobsV1.stories.find((story) => story.id === id)!.turns[0]!.date);
    expect(dates).toEqual([...dates].sort());
  });

  test("renders the owner-context prelude once per historical conversation and never for the trigger probe", () => {
    const historical = steveJobsV1.stories.find((story) => story.id === "microsoft-partnership")!;
    const trigger = steveJobsV1.stories.find((story) => story.id === "implicit-write-trigger")!;
    expect(renderStoryTurn(steveJobsV1, historical, historical.turns[0]!, true))
      .toStartWith(steveJobsV1.conversationPrelude);
    expect(renderStoryTurn(steveJobsV1, historical, historical.turns[1]!, false))
      .not.toContain(steveJobsV1.conversationPrelude);
    expect(renderStoryTurn(steveJobsV1, trigger, trigger.turns[0]!, true))
      .not.toContain(steveJobsV1.conversationPrelude);
  });

  test("makes Apple visible owner context wherever the fixture expects Apple", () => {
    expect(steveJobsV1.conversationPrelude).toMatch(/Apple is my\s+company/);
    expect(steveJobsV1.conversationPrelude).toContain('"we" or "us" I mean Apple');
    for (const story of steveJobsV1.stories) {
      if (!story.subjects.apple) continue;
      const first = renderStoryTurn(steveJobsV1, story, story.turns[0]!, true);
      expect(first, story.id).toMatch(/\bApple\b/);
    }
  });
});
