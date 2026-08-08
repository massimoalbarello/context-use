import { describe, expect, test } from "bun:test";
import { style, truncate, wrapList } from "./terminal.ts";

describe("terminal formatting", () => {
  test("emits plain text when stdout is not an interactive terminal", () => {
    // The test runner is not a TTY, which is also how a redirected run log behaves.
    expect(style.green("done")).toBe("done");
    expect(style.dim(style.bold("nested"))).toBe("nested");
  });

  test("wraps a list under a hanging indent without losing an item", () => {
    const items = Array.from({ length: 12 }, (_, index) => `sl-${String(index).padStart(4, "0")}`);
    const lines = wrapList(items, 6, 40);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(line).toStartWith("      ");
      expect(line.length).toBeLessThanOrEqual(40);
    }
    expect(lines.join(", ").replaceAll(/\s+/g, " ").trim().split(", ")).toEqual(items);
  });

  test("keeps a single item that cannot fit rather than dropping it", () => {
    expect(wrapList(["a-very-long-single-identifier"], 4, 10))
      .toEqual(["    a-very-long-single-identifier"]);
  });

  test("collapses whitespace and marks where it cut", () => {
    expect(truncate("a   b\n c", 40)).toBe("a b c");
    expect(truncate("abcdefghij", 5)).toBe("abcd…");
    expect(truncate("abcde", 5)).toBe("abcde");
  });
});
