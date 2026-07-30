import * as p from "@clack/prompts";
import { defineCommand } from "@parshjs/core";
import { retainedDataVolumeExists } from "../data-volume.ts";
import { dnsMismatches } from "../deploy.ts";
import { readInfrastructure } from "../lifecycle.ts";
import { readConfig } from "../paths.ts";
import { commandExists, run } from "../process.ts";
import type { ComputeOutputs } from "../types.ts";

export const command = defineCommand("doctor", {
  description: "Check local, AWS, DNS, TLS, and application health.",
  options: {},
  handler: async () => {
    const config = await readConfig();
    let compute: ComputeOutputs | null = null;
    const checks: Array<[string, () => Promise<unknown>]> = [
      ["AWS CLI", async () => { if (!(await commandExists("aws"))) throw new Error("not installed"); }],
      ["Terraform", async () => { if (!(await commandExists("terraform"))) throw new Error("not installed"); }],
      ["GitHub CLI", async () => { if (!(await commandExists("gh"))) throw new Error("not installed"); }],
      ["AWS identity", () => run(["aws", "--profile", config.awsProfile, "--region", config.awsRegion, "sts", "get-caller-identity"], { quiet: true })],
      ["Terraform state", async () => {
        const infrastructure = await readInfrastructure(false);
        compute = infrastructure.compute;
        if (!infrastructure.data) throw new Error("retained data stack is absent");
        if (!await retainedDataVolumeExists(config, infrastructure.data)) throw new Error("retained data volume is missing; run `context-use recover`");
        if (!compute) throw new Error("compute stack is absent");
        if (config.recovery) throw new Error("volume recovery is in progress");
      }],
      ["DNS", async () => {
        if (!compute) throw new Error("no active compute output");
        const mismatches = await dnsMismatches(config, compute);
        if (mismatches.length > 0) throw new Error(`${mismatches.join(", ")} do not resolve to ${compute.public_ip}`);
      }],
      ["HTTPS health", async () => {
        const response = await fetch(`https://${config.hostname}/api/health`, { signal: AbortSignal.timeout(5_000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      }],
      ["MCP metadata", async () => {
        const response = await fetch(`https://${config.hostname}/.well-known/oauth-protected-resource/mcp`, { signal: AbortSignal.timeout(5_000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      }],
    ];
    let failed = 0;
    for (const [name, check] of checks) {
      try {
        const value = await check();
        p.log.success(`${name}${value === false || value === "" ? " unavailable" : " OK"}`);
      } catch (error) {
        failed += 1;
        p.log.error(`${name}: ${error instanceof Error ? error.message : "failed"}`);
      }
    }
    if (failed) throw new Error(`${failed} diagnostic check${failed === 1 ? "" : "s"} failed`);
  },
});
