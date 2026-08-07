import { describe, expect, test } from "bun:test";
import {
  composeArguments,
  setupUrl,
  stackEnvironment,
  stackUrl,
  stackVolumeName,
} from "./local-stack.ts";

describe("local stack commands", () => {
  test("keeps development and evaluation data isolated", () => {
    expect(stackEnvironment("local")).toMatchObject({
      CONTEXT_USE_COMPOSE_PROJECT: "context-use-dev",
      CONTEXT_USE_DB_NAME: "context_use",
      CONTEXT_USE_WEB_PORT: "5173",
      CONTEXT_USE_POSTGRES_PORT: "5432",
    });
    expect(stackEnvironment("eval")).toMatchObject({
      CONTEXT_USE_COMPOSE_PROJECT: "context-use-eval",
      CONTEXT_USE_DB_NAME: "context_use_eval",
      CONTEXT_USE_WEB_PORT: "5273",
      CONTEXT_USE_POSTGRES_PORT: "55432",
    });
  });

  test("prints the correct local URLs", () => {
    expect(stackUrl("local")).toBe("http://localhost:5173");
    expect(stackUrl("eval")).toBe("http://localhost:5273");
    expect(setupUrl("eval")).toContain("/app#setup=development-owner-setup-token-");
  });

  test("only purge removes the selected Compose project volumes", () => {
    expect(composeArguments("eval", "purge")).toEqual([
      "compose",
      "--project-name",
      "context-use-eval",
      "down",
      "--volumes",
      "--remove-orphans",
    ]);
    expect(composeArguments("eval", "down")).not.toContain("--volumes");
    expect(stackVolumeName("eval", "asset-data")).toBe("context-use-eval_asset-data");
  });
});
