import { expect, test } from "bun:test";
import { currentVersion } from "./release.ts";

test("version subcommand prints the release version", async () => {
  const child = Bun.spawn([process.execPath, new URL("./index.ts", import.meta.url).pathname, "version"], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  expect(stdout.trim()).toBe(currentVersion);
});
