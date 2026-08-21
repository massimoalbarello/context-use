import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The evaluation harness must not reach a production deployment. Three independent
 * things keep it out, and each is easy to undo by accident, so each is pinned here.
 */

const ROOT = join(import.meta.dir, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

describe("evaluation harness stays out of production", () => {
  test("the production image never copies eval/", () => {
    const copied = [...read("Dockerfile").matchAll(/^COPY (?!--from)(.+?) /gm)]
      .flatMap((match) => match[1]!.split(/\s+/));
    for (const path of copied) expect(path.startsWith("eval")).toBe(false);
  });

  test("no production source imports the harness", () => {
    const glob = new Bun.Glob("apps/**/*.ts");
    for (const file of glob.scanSync({ cwd: ROOT })) {
      if (file.endsWith(".test.ts") || file.includes("/dist/")) continue;
      // A static import would pull the harness into the module graph and into a bundle.
      expect(read(file)).not.toMatch(/^import .*from ["'].*eval\/runner\/corpus\/records/m);
    }
  });

  test("the harness imports only explicit production surfaces, and nothing borrows back", () => {
    const allowedProductionImports = [
      "apps/server/src/nango-records.ts",
      "apps/server/src/conversation-working-sets.ts",
    ];
    const glob = new Bun.Glob("eval/**/*.ts");
    for (const file of glob.scanSync({ cwd: ROOT })) {
      for (const match of read(file).matchAll(/from ["'](\.\.[^"']*apps\/[^"']+)["']/g)) {
        // The reader contract and pure conversation planner belong to production. Evals
        // deliberately exercise those exact surfaces; no other app internals are coupled in.
        expect(allowedProductionImports.some((path) => match[1]!.endsWith(path))).toBe(true);
      }
    }
  });
});
