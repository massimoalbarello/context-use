import { describe, expect, test } from "bun:test";
import {
  CONVERSATION_TURN_MARKER,
  segmentConversationMarkdown,
} from "./conversation-working-sets.ts";

function conversation(turns: Array<{ speaker: string; body: string }>): string {
  return [
    "# Agent conversation",
    "",
    "**Session date:** 20 August 2026",
    ...turns.flatMap(({ speaker, body }) => ["", CONVERSATION_TURN_MARKER, `### ${speaker}`, "", body]),
  ].join("\n");
}

describe("conversation working-set segmentation", () => {
  test("leaves an ordinary conversation byte-for-byte unchanged", () => {
    const markdown = conversation([
      { speaker: "User", body: "A normal question." },
      { speaker: "Assistant", body: "A normal answer." },
    ]);
    expect(segmentConversationMarkdown(markdown)).toEqual([{ markdown, index: 0, count: 1 }]);
  });

  test("balances large conversations at turns and labels overlap separately", () => {
    const markdown = conversation(Array.from({ length: 8 }, (_, index) => ({
      speaker: index % 2 === 0 ? "User" : "Assistant",
      body: `turn-${index + 1}-${"x".repeat(90)}`,
    })));
    const segments = segmentConversationMarkdown(markdown, {
      unsplitLimitBytes: 400,
      targetBytes: 300,
      overlapByteLimit: 300,
      overlapTurns: 2,
    });

    expect(segments.length).toBeGreaterThan(1);
    expect(segments.map(({ index }) => index)).toEqual(segments.map((_, index) => index));
    expect(segments.every(({ count }) => count === segments.length)).toBe(true);
    expect(segments[0]!.markdown).not.toContain("Context from immediately before this excerpt");
    expect(segments[0]!.markdown).toContain("## Conversation to process");
    expect(segments[1]!.markdown).toContain("## Context from immediately before this excerpt");
    expect(segments[1]!.markdown).toContain("already processed");

    const previousNew = segments[0]!.markdown.split("## Conversation to process\n\n")[1]!;
    const overlap = segments[1]!.markdown
      .split("## Context from immediately before this excerpt\n\n")[1]!
      .split("\n\n## Conversation to process")[0]!;
    const priorTurnNumbers = [...previousNew.matchAll(/turn-(\d+)-/g)].map((match) => match[1]);
    expect(priorTurnNumbers.length).toBeGreaterThanOrEqual(2);
    for (const turnNumber of priorTurnNumbers.slice(-2)) {
      expect(overlap).toContain(`turn-${turnNumber}-`);
    }
  });

  test("supports dated named-speaker turns used by conversation-session sources", () => {
    const markdown = [
      "# Conversation between Caroline and Melanie",
      "",
      "**Session date:** 8 May 2023",
      ...Array.from({ length: 6 }, (_, index) => [
        "",
        `### ${index % 2 === 0 ? "Caroline" : "Melanie"} — 8 May 2023`,
        "",
        `turn-${index + 1}-${"x".repeat(90)}`,
      ]).flat(),
    ].join("\n");
    const segments = segmentConversationMarkdown(markdown, {
      turnStyle: "dated-speaker",
      unsplitLimitBytes: 300,
      targetBytes: 240,
    });
    expect(segments.length).toBeGreaterThan(1);
    expect(segments.at(-1)?.markdown).toContain("## Conversation to process");
    expect(segments.at(-1)?.markdown).toContain("### Melanie — 8 May 2023");
  });

  test("does not mistake a heading inside a marked message body for a turn", () => {
    const markdown = conversation([
      { speaker: "User", body: `Before\n\n### Assistant\n\nThis is quoted content.${"x".repeat(220)}` },
      { speaker: "Assistant", body: `Actual answer.${"y".repeat(220)}` },
      { speaker: "User", body: `Follow-up.${"z".repeat(220)}` },
      { speaker: "Assistant", body: `Final answer.${"q".repeat(220)}` },
    ]);
    const segments = segmentConversationMarkdown(markdown, {
      unsplitLimitBytes: 300,
      targetBytes: 400,
    });
    expect(segments.length).toBeGreaterThan(1);
    expect(segments[0]?.markdown).toContain("This is quoted content.");
    const newTurnCount = segments.reduce((total, { markdown }) => total
      + (markdown.split("## Conversation to process\n\n")[1]
        ?.match(/context-use:conversation-turn/g)?.length ?? 0), 0);
    expect(newTurnCount).toBe(4);
  });
});
