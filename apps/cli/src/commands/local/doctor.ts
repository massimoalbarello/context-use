import { defineCommand } from "@parshjs/core";
import { type DiagnosticCheck, originChecks, reportDiagnostics } from "../../instance.ts";
import { localComposeCommands, localNangoOrigin, readLocalTarget } from "../../local.ts";
import { commandExists } from "../../process.ts";

export const command = defineCommand("local doctor", {
  description: "Check Docker, the local services, and application health.",
  options: {},
  handler: async () => {
    const { config, target } = await readLocalTarget();
    // The cloud checks that have no local counterpart are simply absent rather
    // than stubbed: there is no AWS identity, no DNS, no TLS, and no public
    // Nango edge to assert a boundary on.
    const checks: DiagnosticCheck[] = [
      ["Docker", async () => { if (!(await commandExists("docker"))) throw new Error("not installed"); }],
      ["Compose services", async () => {
        const output = await target.run(localComposeCommands(target, "ps", "--status", "running", "--format", "'{{.Service}}'"));
        const running = output.split("\n").filter(Boolean);
        if (running.length === 0) throw new Error("no service is running; run `context-use local setup`");
        return running.join(", ");
      }],
      ...originChecks(target.origin),
      ["Nango readiness", async () => {
        const response = await fetch(`${localNangoOrigin(config)}/health`, { signal: AbortSignal.timeout(5_000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return true;
      }],
    ];
    await reportDiagnostics(checks);
  },
});
