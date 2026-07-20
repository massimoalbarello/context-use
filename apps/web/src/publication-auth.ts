import { startAuthentication } from "@simplewebauthn/browser";
import { api } from "./api.ts";

export type PublicationAction = "publish" | "unpublish";

export async function confirmPublicationChange({
  action,
  targetKind,
  targetId,
  versionId,
}: {
  action: PublicationAction;
  targetKind: "page" | "asset";
  targetId: string;
  versionId: string | null;
}): Promise<void> {
  const created = await api<{
    intent: { id: string };
    authentication_options: Parameters<typeof startAuthentication>[0]["optionsJSON"];
  }>("/api/dashboard/publication-intents", {
    method: "POST",
    body: JSON.stringify({
      action,
      target_kind: targetKind,
      target_id: targetId,
      version_id: versionId,
    }),
  });
  const response = await startAuthentication({ optionsJSON: created.authentication_options });
  await api("/api/dashboard/publications/confirm", {
    method: "POST",
    body: JSON.stringify({ intent_id: created.intent.id, response }),
  });
}
