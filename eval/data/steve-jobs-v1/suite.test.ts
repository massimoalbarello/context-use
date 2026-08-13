import { describe, expect, test } from "bun:test";
import { renderStoryTurn, storyRunnerInternals } from "../../runner/story/runner.ts";
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

  test("prompts every fresh conversation to use Context Use but supplies owner context only once", () => {
    const historical = steveJobsV1.journey.map((id) =>
      steveJobsV1.stories.find((story) => story.id === id)!);
    const plan = storyRunnerInternals.planStoryConversations(historical);
    expect(plan.map(({ story }) => story.id)).toEqual(steveJobsV1.journey);
    expect(plan.map(({ includeSuitePrelude }) => includeSuitePrelude))
      .toEqual([true, false, false, false, false, false]);

    const prompts = plan.map(({ story, includeSuitePrelude }) =>
      renderStoryTurn(steveJobsV1, story, story.turns[0]!, true, includeSuitePrelude));
    for (const prompt of prompts) {
      expect(prompt).toStartWith(steveJobsV1.conversationPrelude);
    }
    expect(prompts[0]).toContain(steveJobsV1.suitePrelude);
    for (const prompt of prompts.slice(1)) {
      expect(prompt).not.toContain(steveJobsV1.suitePrelude);
    }
  });

  test("keeps the implicit trigger fully unprompted without consuming suite context", () => {
    const plan = storyRunnerInternals.planStoryConversations(steveJobsV1.stories);
    expect(plan.slice(0, 2).map(({ story, includeSuitePrelude }) => ({
      story: story.id,
      includeSuitePrelude,
    }))).toEqual([
      { story: "implicit-write-trigger", includeSuitePrelude: false },
      { story: "microsoft-partnership", includeSuitePrelude: true },
    ]);
    const trigger = plan[0]!;
    const prompt = renderStoryTurn(
      steveJobsV1,
      trigger.story,
      trigger.story.turns[0]!,
      true,
      trigger.includeSuitePrelude,
    );
    expect(prompt).not.toContain(steveJobsV1.conversationPrelude);
    expect(prompt).not.toContain(steveJobsV1.suitePrelude);
  });
});
