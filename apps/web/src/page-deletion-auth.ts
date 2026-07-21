import { startAuthentication } from "@simplewebauthn/browser";
import { api } from "./api.ts";

export async function confirmPageDeletion(pageId: string): Promise<void> {
  const created = await api<{
    intent: { id: string };
    authentication_options: Parameters<typeof startAuthentication>[0]["optionsJSON"];
  }>(`/api/dashboard/pages/${pageId}/deletion-intents`, {
    method: "POST",
    body: "{}",
  });
  const response = await startAuthentication({ optionsJSON: created.authentication_options });
  await api("/api/dashboard/page-deletions/confirm", {
    method: "POST",
    body: JSON.stringify({ intent_id: created.intent.id, response }),
  });
}
