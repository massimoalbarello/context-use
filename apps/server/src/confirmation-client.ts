import type { ConfirmationIntentKind } from "@context-use/database";
import type { DashboardPrincipal } from "./auth-client.ts";
import { config } from "./config.ts";

export async function issueConfirmationOptions(
  kind: ConfirmationIntentKind,
  intentId: string,
): Promise<unknown> {
  const endpoint = config.CONFIRMATION_INTERNAL_URL;
  const internalRequest = new Request(`${endpoint}/internal/confirmation/${kind}/${encodeURIComponent(intentId)}/options`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.CONFIRMATION_DASHBOARD_TOKEN}`,
      "content-type": "application/json",
    },
    body: "{}",
  });
  const local = (globalThis as typeof globalThis & {
    __contextUseConfirmationHandler?: (request: Request) => Promise<Response> | Response;
  }).__contextUseConfirmationHandler;
  const response = local ? await local(internalRequest) : await fetch(internalRequest);
  if (!response.ok) throw new Error(`Confirmation service could not issue a challenge (${response.status})`);
  return response.json();
}

async function exportDownloadMark(
  intentId: string,
  principal: DashboardPrincipal,
  path: "claim" | "complete-download",
): Promise<void> {
  const endpoint = config.CONFIRMATION_INTERNAL_URL;
  const internalRequest = new Request(`${endpoint}/internal/knowledge-exports/${encodeURIComponent(intentId)}/${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.CONFIRMATION_DASHBOARD_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ owner_user_id: principal.userId, session_id: principal.sessionId }),
  });
  const local = (globalThis as typeof globalThis & {
    __contextUseConfirmationHandler?: (request: Request) => Promise<Response> | Response;
  }).__contextUseConfirmationHandler;
  const response = local ? await local(internalRequest) : await fetch(internalRequest);
  if (!response.ok) throw new Error(`Confirmation service could not mark the export (${response.status})`);
}

export async function claimConfirmedExport(intentId: string, principal: DashboardPrincipal): Promise<void> {
  await exportDownloadMark(intentId, principal, "claim");
}

// Recorded only once the archive bytes have actually left the server, because a
// pending knowledge reset is gated on the owner holding a complete archive.
export async function completeConfirmedExportDownload(intentId: string, principal: DashboardPrincipal): Promise<void> {
  await exportDownloadMark(intentId, principal, "complete-download");
}
