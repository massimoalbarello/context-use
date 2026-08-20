import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CONFIG_PATH,
  LOCAL_CONFIG_PATH,
  configInternals,
  describeSelection,
  loadEvalConfig,
  selectionCorpus,
} from "./config.ts";
import { ROOT } from "./runner/agent.ts";

/** Resolves a configuration from throwaway files standing in for the two real layers. */
function layered(...layers: unknown[]): ReturnType<typeof loadEvalConfig> {
  const directory = mkdtempSync(join(tmpdir(), "eval-config-"));
  return loadEvalConfig(layers.map((layer, index) => {
    const path = join(directory, `layer-${index}.json`);
    writeFileSync(path, JSON.stringify(layer), "utf8");
    return path;
  }));
}

describe("the committed configuration", () => {
  test("is what every eval command defaults to", () => {
    const config = loadEvalConfig([CONFIG_PATH]);
    expect(config.sources).toEqual([CONFIG_PATH]);
    expect(config.harness.provider).toBe("codex");
    expect(config.knowledgeTemplate).toBe("default");
    // One day of the corpus that matches what Context Use actually does.
    expect(config.eval).toEqual({
      command: "distill", corpus: "amara-life-v1", window: "dense", batches: 1,
    });
  });

  test("keeps a local override out of commits", () => {
    expect(LOCAL_CONFIG_PATH.endsWith("config.local.json")).toBe(true);
    const ignored = readFileSync(join(ROOT, ".gitignore"), "utf8").split("\n");
    expect(ignored).toContain("/eval/config.local.json");
  });
});

describe("layering", () => {
  test("falls back to the built-in configuration when no file exists", () => {
    expect(loadEvalConfig([join(tmpdir(), "no-such-eval-config.json")])).toEqual(configInternals.BUILT_IN);
  });

  test("merges the harness field by field", () => {
    const config = layered(
      { harness: { provider: "claude", model: "claude-opus-5" } },
      { harness: { model: "claude-sonnet-5" } },
    );
    expect(config.harness).toEqual({ provider: "claude", model: "claude-sonnet-5" });
  });

  test("overrides the knowledge template independently", () => {
    const config = layered(
      { knowledgeTemplate: "default", eval: { command: "journey" } },
      { knowledgeTemplate: "greedy" },
    );
    expect(config.knowledgeTemplate).toBe("greedy");
    expect(config.eval).toEqual({ command: "journey" });
  });

  test("drops an inherited model when a later layer changes provider", () => {
    const config = layered(
      { harness: { provider: "claude", model: "claude-opus-5" } },
      { harness: { provider: "codex" } },
    );
    expect(config.harness).toEqual({ provider: "codex" });
  });

  test("replaces the selection whole rather than merging two of them", () => {
    const config = layered(
      { eval: { command: "distill", corpus: "amara-life-v1", window: "dense", batches: 2 } },
      { eval: { command: "journey" } },
    );
    expect(config.eval).toEqual({ command: "journey" });
  });

  test("defaults a distillation window to the whole corpus", () => {
    expect(layered({ eval: { command: "distill", corpus: "world-v1" } }).eval)
      .toEqual({ command: "distill", corpus: "world-v1", window: "full" });
  });

  test("records every file it read, nearest last", () => {
    expect(layered({ harness: { provider: "codex" } }, { eval: { command: "journey" } }).sources)
      .toHaveLength(2);
  });
});

describe("validation", () => {
  test("names the file and the field it could not accept", () => {
    expect(() => layered({ harnes: { provider: "claude" } }))
      .toThrow(/layer-0\.json[\s\S]*config: Unrecognized key: "harnes"/);
  });

  test("rejects a field that belongs to another command", () => {
    expect(() => layered({ eval: { command: "journey", corpus: "world-v1" } }))
      .toThrow(/config\.eval: Unrecognized key: "corpus"/);
  });

  test("rejects the removed LoCoMo question selectors", () => {
    expect(() => layered({ eval: { command: "locomo", all: true, questions: 10 } }))
      .toThrow(/Unrecognized key: "questions"/);
    expect(() => layered({ eval: { command: "locomo", all: true, stratify: 2 } }))
      .toThrow(/Unrecognized key: "stratify"/);
  });

  // A misspelling that silently kept the default would report one run and measure another.
  test("rejects a misspelled count rather than keeping the default", () => {
    expect(() => layered({ eval: { command: "distill", corpus: "world-v1", batchs: 1 } }))
      .toThrow(/Unrecognized key: "batchs"/);
  });

  test("rejects an unknown provider, corpus, window and command", () => {
    expect(() => layered({ harness: { provider: "cursor" } })).toThrow(/config\.harness\.provider/);
    expect(() => layered({ eval: { command: "distill", corpus: "amara-life-v2" } }))
      .toThrow(/config\.eval\.corpus/);
    expect(() => layered({ eval: { command: "distill", corpus: "world-v1", window: "wide" } }))
      .toThrow(/config\.eval\.window/);
    expect(() => layered({ eval: { command: "score" } })).toThrow(/Invalid discriminator value/);
  });

  test("rejects an unknown knowledge template", () => {
    expect(() => layered({ knowledgeTemplate: "dummy" }))
      .toThrow(/config\.knowledgeTemplate/);
  });

  test("rejects a batch count that is not a whole number of at least one", () => {
    expect(() => layered({ eval: { command: "distill", corpus: "world-v1", batches: 0 } }))
      .toThrow(/config\.eval\.batches/);
    expect(() => layered({ eval: { command: "distill", corpus: "world-v1", batches: 1.5 } }))
      .toThrow(/expected int/);
  });

  test("requires the field its command cannot run without", () => {
    expect(() => layered({ eval: { command: "distill" } })).toThrow(/config\.eval\.corpus/);
    expect(() => layered({ eval: { command: "story" } })).toThrow(/config\.eval\.story/);
  });
});

describe("description", () => {
  test("names what each command would run", () => {
    expect(describeSelection({ command: "distill", corpus: "world-v1", window: "full", batches: 1 }))
      .toBe("distill world-v1 · full window · 1 batch");
    expect(describeSelection({ command: "qa", corpus: "world-v1", window: "full" }))
      .toBe("qa world-v1 · full window · every batch · prepare, ask, score");
    expect(describeSelection({ command: "story", story: "all", repeat: 3 }))
      .toBe("story suite · every story · 3 repetitions");
    expect(describeSelection({ command: "journey" }))
      .toBe("journey · the historical stories in order");
    expect(describeSelection({ command: "locomo", conversation: "conv-30" }))
      .toBe("locomo · conv-30 · every question");
  });

  test("reports the corpus only where a selection has one", () => {
    expect(selectionCorpus({ command: "qa", corpus: "world-v1", window: "full" })).toBe("world-v1");
    expect(selectionCorpus({ command: "journey" })).toBeUndefined();
  });
});
