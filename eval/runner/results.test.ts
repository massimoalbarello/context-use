import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./agent.ts";
import { EVAL_RESULTS_ROOT } from "./results.ts";

describe("local evaluation results", () => {
  test("live together under a gitignored eval-local directory", () => {
    expect(EVAL_RESULTS_ROOT).toBe(join(ROOT, "eval", "results"));
    const ignored = readFileSync(join(ROOT, ".gitignore"), "utf8").split("\n");
    expect(ignored).toContain("/eval/results/");
  });
});
