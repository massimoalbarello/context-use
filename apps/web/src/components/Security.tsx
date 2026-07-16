import { startAuthentication } from "@simplewebauthn/browser";
import { useEffect, useState } from "react";
import { api } from "../api.ts";
import { authClient } from "../auth-client.ts";
import type { AuditEvent, ConnectedClient } from "../types.ts";

export type PasskeySummary = { id: string; name: string | null; created_at: string };

export function Security({ passkeys, onPasskeysChanged }: { passkeys: PasskeySummary[]; onPasskeysChanged: () => Promise<void> }) {
  const [clients, setClients] = useState<ConnectedClient[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [message, setMessage] = useState("");
  const load = async () => {
    const [nextClients, nextEvents] = await Promise.all([
      api<ConnectedClient[]>("/api/dashboard/oauth-clients"),
      api<AuditEvent[]>("/api/dashboard/audit"),
    ]);
    setClients(nextClients); setEvents(nextEvents);
  };
  useEffect(() => { load().catch((error: Error) => setMessage(error.message)); }, []);

  const revoke = async (client: ConnectedClient) => {
    if (!confirm(`Revoke ${client.name ?? client.client_id}? Its consent and refresh tokens will stop working immediately.`)) return;
    await api(`/api/dashboard/oauth-clients/${encodeURIComponent(client.client_id)}`, { method: "DELETE" });
    setMessage("MCP client revoked."); await load();
  };

  const removePasskey = async (passkey: PasskeySummary) => {
    if (passkeys.length <= 1) { setMessage("The final passkey cannot be removed. Add a recovery passkey first."); return; }
    const created = await api<{ intent: { id: string }; authentication_options: Parameters<typeof startAuthentication>[0]["optionsJSON"] }>("/api/dashboard/passkey-management/intents", {
      method: "POST", body: JSON.stringify({ action: "delete_passkey", target_credential_id: passkey.id }),
    });
    const response = await startAuthentication({ optionsJSON: created.authentication_options });
    const grant = await api<{ management_token: string }>("/api/dashboard/passkey-management/confirm", {
      method: "POST", body: JSON.stringify({ intent_id: created.intent.id, response }),
    });
    const result = await authClient.passkey.deletePasskey({
      id: passkey.id,
      fetchOptions: { headers: { "x-passkey-management-token": grant.management_token } },
    });
    if (result.error) throw new Error(result.error.message ?? "Could not remove passkey");
    setMessage("Passkey removed."); await onPasskeysChanged(); await load();
  };

  return <main className="content-page security-page"><header><div><span className="eyebrow">Owner-only controls</span><h1>Security</h1></div></header>
    {message && <p>{message}</p>}
    <section><h2>Passkeys</h2><p>Publishing and credential changes require user verification. Keep at least two passkeys for recovery.</p><div className="security-list">{passkeys.map((key) => <article key={key.id}><div><strong>{key.name || "Passkey"}</strong><span>Added {new Date(key.created_at).toLocaleString()}</span></div><button disabled={passkeys.length <= 1} onClick={() => removePasskey(key).catch((error: Error) => setMessage(error.message))}>Remove with passkey</button></article>)}</div></section>
    <section><h2>Connected MCP clients</h2>{clients.length === 0 ? <p>No agent is connected.</p> : <div className="security-list">{clients.map((client) => <article key={client.client_id}><div><strong>{client.name || client.client_id}</strong><span>{client.scopes.join(" · ")} · last used {client.last_used_at ? new Date(client.last_used_at).toLocaleString() : "never"}</span></div><button className="danger" onClick={() => revoke(client).catch((error: Error) => setMessage(error.message))}>Revoke</button></article>)}</div>}</section>
    <section><h2>Audit history</h2><div className="audit-list">{events.map((event) => <article key={`${event.event_type}-${event.id}`}><strong>{event.event_type.replaceAll("_", " ")}</strong><span>{event.target_type ? `${event.target_type} · ` : ""}{new Date(event.created_at).toLocaleString()}</span></article>)}</div></section>
  </main>;
}
