import * as p from "@clack/prompts";
import { healthMatchesVersion } from "./deploy.ts";
import { runKnowledgeTemplateCommand, type KnowledgeTemplateAction } from "./knowledge-template.ts";
import type { DeploymentTarget } from "./target.ts";

/**
 * Operations that are identical on both targets because they depend only on the
 * origin serving the instance or on the Compose shell the target executes.
 */

export type DiagnosticCheck = [string, () => Promise<unknown>];

export async function instanceHealthy(origin: string, releaseVersion: string): Promise<boolean> {
  try {
    const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(5_000) });
    return response.ok && healthMatchesVersion(await response.json(), releaseVersion);
  } catch {
    return false;
  }
}

/** Checks every instance supports, whatever computer it runs on. */
export function originChecks(origin: string): DiagnosticCheck[] {
  return [
    ["Application health", async () => {
      const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(5_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    }],
    ["MCP metadata", async () => {
      const response = await fetch(`${origin}/.well-known/oauth-protected-resource/mcp`, { signal: AbortSignal.timeout(5_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    }],
  ];
}

export async function reportDiagnostics(checks: DiagnosticCheck[]): Promise<void> {
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
}

export function openDashboard(origin: string): void {
  Bun.spawn([process.platform === "darwin" ? "open" : "xdg-open", `${origin}/app`]);
}

export async function reportKnowledgeTemplate(
  target: DeploymentTarget,
  action: KnowledgeTemplateAction,
  forceTemplate: boolean,
): Promise<void> {
  const output = (await runKnowledgeTemplateCommand(target, action, { forceTemplate })).trim();
  p.note(output || "No template changes", action === "plan" ? "Default template plan" : "Default template applied");
}
