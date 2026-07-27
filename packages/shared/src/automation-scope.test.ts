import { describe, expect, test } from "bun:test";
import {
  AutomationScopeError,
  assertWithinWriteScope,
  assertWriteScopePattern,
  isWithinWriteScope,
  resolveScopePattern,
  resolveWriteScope,
  runDateParts,
} from "./automation-scope.ts";

const scheduledFor = new Date("2026-07-27T22:30:00Z");

describe("write scope patterns", () => {
  test("accepts a dated diary page and a plain entity subtree", () => {
    expect(() => assertWriteScopePattern("about/diary/{YYYY}/{MM}/{DD}/services-digest")).not.toThrow();
    expect(() => assertWriteScopePattern("companies/*")).not.toThrow();
    expect(() => assertWriteScopePattern("people/**")).not.toThrow();
  });

  test("rejects patterns that would grant most of the knowledge base at once", () => {
    expect(() => assertWriteScopePattern("**")).toThrow(AutomationScopeError);
    expect(() => assertWriteScopePattern("*/diary")).toThrow(AutomationScopeError);
    expect(() => assertWriteScopePattern("{YYYY}/notes")).toThrow(AutomationScopeError);
  });

  test("rejects a wildcard that is not the final segment", () => {
    expect(() => assertWriteScopePattern("about/**/log")).toThrow(AutomationScopeError);
  });

  test("refuses to grant another automation's folder", () => {
    expect(() => assertWriteScopePattern("automations/other-automation/**")).toThrow(AutomationScopeError);
  });

  test("rejects malformed paths", () => {
    expect(() => assertWriteScopePattern("/about/diary")).toThrow(AutomationScopeError);
    expect(() => assertWriteScopePattern("about//diary")).toThrow(AutomationScopeError);
    expect(() => assertWriteScopePattern("about/diary/")).toThrow(AutomationScopeError);
    expect(() => assertWriteScopePattern("About/Diary")).toThrow(AutomationScopeError);
    expect(() => assertWriteScopePattern(" about/diary")).toThrow(AutomationScopeError);
  });
});

describe("date templates", () => {
  test("resolves against the run's own date, in the automation's time zone", () => {
    // 22:30 UTC is already the 28th in Tokyo and still the 27th in London.
    expect(runDateParts(scheduledFor, "Europe/London")).toEqual({ YYYY: "2026", MM: "07", DD: "27" });
    expect(runDateParts(scheduledFor, "Asia/Tokyo")).toEqual({ YYYY: "2026", MM: "07", DD: "28" });
  });

  test("substitutes every token", () => {
    expect(
      resolveScopePattern("about/diary/{YYYY}/{MM}/{DD}/log", runDateParts(scheduledFor, "Europe/London")),
    ).toBe("about/diary/2026/07/27/log");
  });

  test("reports an unusable time zone rather than writing the wrong day", () => {
    expect(() => runDateParts(scheduledFor, "Mars/Olympus")).toThrow(AutomationScopeError);
  });
});

describe("resolved scope", () => {
  const scope = resolveWriteScope(
    "services-digest",
    ["about/diary/{YYYY}/{MM}/{DD}/services-digest", "about/diary/{YYYY}/{MM}/{DD}/log"],
    scheduledFor,
    "Europe/London",
  );

  test("always includes the automation's own folder, so an empty scope behaves as before", () => {
    const bare = resolveWriteScope("services-digest", [], scheduledFor, "Europe/London");
    expect(bare.patterns).toEqual(["automations/services-digest/**"]);
    expect(isWithinWriteScope(bare, "automations/services-digest/2026-07-27")).toBe(true);
    expect(isWithinWriteScope(bare, "about/diary/2026/07/27/services-digest")).toBe(false);
  });

  test("grants the run's own day and nothing else", () => {
    expect(isWithinWriteScope(scope, "about/diary/2026/07/27/services-digest")).toBe(true);
    expect(isWithinWriteScope(scope, "about/diary/2026/07/27/log")).toBe(true);
    expect(isWithinWriteScope(scope, "about/diary/2026/07/26/log")).toBe(false);
    expect(isWithinWriteScope(scope, "about/diary/2025/07/27/log")).toBe(false);
  });

  test("does not leak into neighbouring pages of the same day", () => {
    expect(isWithinWriteScope(scope, "about/diary/2026/07/27/meetings-roundup")).toBe(false);
    expect(isWithinWriteScope(scope, "about/diary/2026/07/27")).toBe(false);
  });

  test("never grants the automation folder of another automation", () => {
    expect(isWithinWriteScope(scope, "automations/other/2026-07-27")).toBe(false);
  });

  test("`*` matches one segment and `**` matches a subtree but not the folder page", () => {
    const wide = resolveWriteScope("enricher", ["companies/*", "people/**"], scheduledFor, "UTC");
    expect(isWithinWriteScope(wide, "companies/acme")).toBe(true);
    expect(isWithinWriteScope(wide, "companies/acme/intro")).toBe(false);
    expect(isWithinWriteScope(wide, "people/ada-lovelace")).toBe(true);
    expect(isWithinWriteScope(wide, "people/ada-lovelace/intro")).toBe(true);
    expect(isWithinWriteScope(wide, "people")).toBe(false);
  });

  test("names the granted paths when it refuses a write", () => {
    expect(() => assertWithinWriteScope(scope, "about/intro")).toThrow(/about\/diary\/2026\/07\/27\/log/);
  });
});
