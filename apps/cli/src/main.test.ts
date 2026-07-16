import { expect, test } from "bun:test";
import { currentVersion } from "./release.ts";

async function runCli(...args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const child = Bun.spawn([process.execPath, new URL("./main.ts", import.meta.url).pathname, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);

  return { stdout, stderr, exitCode };
}

test("version subcommand prints the release version", async () => {
  const result = await runCli("version");

  expect(result.stderr).toBe("");
  expect(result.exitCode).toBe(0);
  expect(result.stdout.trim()).toBe(currentVersion);
});

test("built-in version flag prints the release version", async () => {
  const result = await runCli("--version");

  expect(result.stderr).toBe("");
  expect(result.exitCode).toBe(0);
  expect(result.stdout.trim()).toBe(currentVersion);
});

test("root help lists the operational commands", async () => {
  const result = await runCli("--help");

  expect(result.stderr).toBe("");
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("setup");
  expect(result.stdout).not.toContain("recover-passkey");
  expect(result.stdout).toContain("destroy");
});

test("command help preserves release and purge options", async () => {
  const [update, destroy] = await Promise.all([
    runCli("update", "--help"),
    runCli("destroy", "--help"),
  ]);

  expect(update.exitCode).toBe(0);
  expect(update.stdout).toContain("--version");
  expect(destroy.exitCode).toBe(0);
  expect(destroy.stdout).toContain("--purge-data");
});
