import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The evaluation harness must not reach a production deployment. Three independent
 * things keep it out, and each is easy to undo by accident, so each is pinned here.
 */

const ROOT = join(import.meta.dir, "..");
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
      expect(read(file)).not.toMatch(/^import .*from ["'].*eval\/corpus-records/m);
    }
  });

  test("the harness borrows only the reader contract, and nothing borrows back", () => {
    const glob = new Bun.Glob("eval/**/*.ts");
    for (const file of glob.scanSync({ cwd: ROOT })) {
      for (const match of read(file).matchAll(/from ["'](\.\.[^"']*apps\/[^"']+)["']/g)) {
        // The contract belongs to production; the evaluation implements it, not the
        // other way round. Anything else would couple the two.
        expect(match[1]).toContain("apps/server/src/nango-records.ts");
      }
    }
  });
});
