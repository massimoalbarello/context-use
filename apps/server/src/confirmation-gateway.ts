import type { ConfirmationIntentKind } from "@context-use/database";
import type { DashboardPrincipal } from "./auth-client.ts";
import { config } from "./config.ts";

export async function forwardBrowserConfirmation(
  kind: ConfirmationIntentKind,
  confirmation: unknown,
  principal: DashboardPrincipal,
): Promise<Response> {
  const request = new Request(`${config.CONFIRMATION_INTERNAL_URL}/internal/browser-confirmation/${kind}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.CONFIRMATION_GATEWAY_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      principal: {
        owner_user_id: principal.userId,
        session_id: principal.sessionId,
      },
      confirmation,
    }),
  });
  const local = (globalThis as typeof globalThis & {
    __contextUseConfirmationHandler?: (request: Request) => Promise<Response> | Response;
  }).__contextUseConfirmationHandler;
  return local ? local(request) : fetch(request);
}
