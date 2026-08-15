import { defineCommand } from "@parshjs/core";
import { retainedDataVolumeExists } from "../../data-volume.ts";
import { dnsMismatches } from "../../deploy.ts";
import { type DiagnosticCheck, originChecks, reportDiagnostics } from "../../instance.ts";
import { readInfrastructure } from "../../lifecycle.ts";
import { probeInternalNangoReady, verifyExternalNangoBoundary } from "../../nango-internal.ts";
import { verifyNangoDashboardAuthentication } from "../../nango.ts";
import { readConfig } from "../../paths.ts";
import { commandExists, run } from "../../process.ts";
import type { ComputeOutputs, DataOutputs } from "../../types.ts";

export const command = defineCommand("cloud doctor", {
  description: "Check local, AWS, DNS, TLS, and application health.",
  options: {},
  handler: async () => {
    const config = await readConfig();
    let compute: ComputeOutputs | null = null;
    let data: DataOutputs | null = null;
    const checks: DiagnosticCheck[] = [
      ["AWS CLI", async () => { if (!(await commandExists("aws"))) throw new Error("not installed"); }],
      ["Terraform", async () => { if (!(await commandExists("terraform"))) throw new Error("not installed"); }],
      ["GitHub CLI", async () => { if (!(await commandExists("gh"))) throw new Error("not installed"); }],
      ["AWS identity", () => run(["aws", "--profile", config.awsProfile, "--region", config.awsRegion, "sts", "get-caller-identity"], { quiet: true })],
      ["Terraform state", async () => {
        const infrastructure = await readInfrastructure(false);
        compute = infrastructure.compute;
        data = infrastructure.data;
        if (!infrastructure.data) throw new Error("retained data stack is absent");
        if (!await retainedDataVolumeExists(config, infrastructure.data)) throw new Error("retained data volume is missing; run `context-use cloud recover`");
        if (!compute) throw new Error("compute stack is absent");
        if (config.recovery) throw new Error("volume recovery is in progress");
      }],
      ["DNS", async () => {
        if (!compute) throw new Error("no active compute output");
        const mismatches = await dnsMismatches(config, compute);
        if (mismatches.length > 0) throw new Error(`${mismatches.join(", ")} do not resolve to ${compute.public_ip}`);
      }],
      ...originChecks(`https://${config.hostname}`),
      ["Nango internal readiness", async () => {
        if (!compute) throw new Error("no active compute output");
        if (!await probeInternalNangoReady(config, compute.instance_id)) throw new Error("unexpected response");
        return true;
      }],
      ["Nango external boundary", async () => {
        if (!compute) throw new Error("no active compute output");
        return verifyExternalNangoBoundary(config, compute.instance_id);
      }],
      ["Nango dashboard authentication", () => {
        if (!compute || !data) throw new Error("no active infrastructure output");
        return verifyNangoDashboardAuthentication(config, data, compute.instance_id);
      }],
    ];
    await reportDiagnostics(checks);
  },
});
