import { describe, expect, test } from "bun:test";
import config from "./vite.config.ts";

describe("Vite development proxy", () => {
  test("does not route the dashboard /app path through the public asset proxy", () => {
    if (typeof config !== "object") throw new Error("Expected an object Vite configuration");
    expect(config.server?.proxy).toHaveProperty("/a/");
    expect(config.server?.proxy).not.toHaveProperty("/a");
  });
});
