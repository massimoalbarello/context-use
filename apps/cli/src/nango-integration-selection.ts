import { MANAGED_INTEGRATIONS } from "../../../nango-integrations/catalog.ts";

export type ManagedIntegration = (typeof MANAGED_INTEGRATIONS)[number];

/**
 * Integrations a user configures themselves. Hidden entries exist so their
 * records flow through the same pipeline, but they are provisioned by their
 * own command (agent-conversations by `agent-sync install`) rather than chosen
 * from this catalog.
 */
export function selectableIntegrations(): ManagedIntegration[] {
  return MANAGED_INTEGRATIONS.filter((candidate) => !("hidden" in candidate && candidate.hidden));
}

export function resolveSelectableIntegration(id: string): ManagedIntegration {
  const selectable = selectableIntegrations();
  const integration = selectable.find((candidate) => candidate.id === id);
  if (!integration) {
    throw new Error(
      `Unknown Nango integration ${id}; choose one of ${selectable.map((candidate) => candidate.id).join(", ")}`,
    );
  }
  return integration;
}

export function usesStaticOAuth(integration: ManagedIntegration): boolean {
  return "oauth" in integration;
}

export function requiresDashboardSetup(integration: ManagedIntegration): boolean {
  return "setup" in integration && integration.setup === "manual";
}

/** The provider name as the Nango dashboard lists it, which can differ from its API key. */
export function dashboardProviderLabel(integration: ManagedIntegration): string {
  return "dashboardProvider" in integration ? integration.dashboardProvider : integration.provider;
}
