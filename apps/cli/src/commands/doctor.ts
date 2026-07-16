import * as p from "@clack/prompts";
import { defineCommand } from "@parshjs/core";
import { verifyRemoteSecurity } from "../deploy.ts";
import { readConfig } from "../paths.ts";
import { commandExists, run } from "../process.ts";

export const command = defineCommand("doctor", {
  description: "Check local, AWS, DNS, TLS, and application health.",
  options: {},
  handler: async () => {
    const config = await readConfig();
    const checks: Array<[string, () => Promise<unknown>]> = [
      ["AWS CLI", async () => { if (!(await commandExists("aws"))) throw new Error("not installed"); }],
      ["Terraform", async () => { if (!(await commandExists("terraform"))) throw new Error("not installed"); }],
      ["GitHub CLI", async () => { if (!(await commandExists("gh"))) throw new Error("not installed"); }],
      ["AWS identity", () => run(["aws", "--profile", config.awsProfile, "--region", config.awsRegion, "sts", "get-caller-identity"], { quiet: true })],
      ["DNS", () => run(["dig", "+short", config.hostname], { quiet: true })],
      ["HTTPS health", async () => {
        const response = await fetch(`https://${config.hostname}/api/health`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      }],
      ["MCP metadata", async () => {
        const response = await fetch(`https://${config.hostname}/.well-known/oauth-protected-resource/mcp`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      }],
      ["Remote database, S3, and backup isolation", () => verifyRemoteSecurity(config)],
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
