import { describe, expect, test } from "bun:test";
import config from "./vite.config.ts";

function proxyTable(): Record<string, unknown> {
  if (typeof config !== "object") throw new Error("Expected an object Vite configuration");
  const proxy = config.server?.proxy;
  if (!proxy) throw new Error("Expected a configured development proxy");
  return proxy as Record<string, unknown>;
}

describe("Vite development proxy", () => {
  test("does not route the dashboard /app path through the public asset proxy", () => {
    expect(proxyTable()).toHaveProperty("/a/");
    expect(proxyTable()).not.toHaveProperty("/a");
  });

  test("forwards crawler and agent discovery documents", () => {
    const paths = Object.keys(proxyTable());
    for (const path of ["/robots.txt", "/sitemap.xml", "/llms.txt", "/llms-full.txt"]) {
      expect(paths).toContain(path);
    }
  });

  test("forwards the browser Host so origin checks still match APP_ORIGIN", () => {
    const proxy = proxyTable();
    expect(Object.keys(proxy).length).toBeGreaterThan(0);
    for (const [path, options] of Object.entries(proxy)) {
      // A rewritten Host makes every guarded dashboard route answer 404 security_error.
      expect({ path, changeOrigin: (options as { changeOrigin?: boolean }).changeOrigin })
        .toEqual({ path, changeOrigin: false });
    }
  });
});
