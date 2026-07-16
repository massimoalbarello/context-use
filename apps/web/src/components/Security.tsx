import { useEffect, useState } from "react";
import { api } from "../api.ts";
import type { AuditEvent, ConnectedClient } from "../types.ts";

export type PasskeySummary = { id: string; name: string | null; created_at: string };

export function Security({ passkeys }: { passkeys: PasskeySummary[] }) {
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

  return <main className="content-page security-page"><header><div><span className="eyebrow">Owner-only controls</span><h1>Security</h1></div></header>
    {message && <p>{message}</p>}
    <section><h2>Publication passkey</h2><p>Registered publication credentials are permanent. No passkeys can be added, replaced, or removed after initial setup.</p><div className="security-list">{passkeys.map((key) => <article key={key.id}><div><strong>{key.name || "Passkey"}</strong><span>Added {new Date(key.created_at).toLocaleString()}</span></div></article>)}</div></section>
    <section><h2>Connected MCP clients</h2>{clients.length === 0 ? <p>No agent is connected.</p> : <div className="security-list">{clients.map((client) => <article key={client.client_id}><div><strong>{client.name || client.client_id}</strong><span>{client.scopes.join(" · ")} · last used {client.last_used_at ? new Date(client.last_used_at).toLocaleString() : "never"}</span></div><button className="danger" onClick={() => revoke(client).catch((error: Error) => setMessage(error.message))}>Revoke</button></article>)}</div>}</section>
    <section><h2>Audit history</h2><div className="audit-list">{events.map((event) => <article key={`${event.event_type}-${event.id}`}><strong>{event.event_type.replaceAll("_", " ")}</strong><span>{event.target_type ? `${event.target_type} · ` : ""}{new Date(event.created_at).toLocaleString()}</span></article>)}</div></section>
  </main>;
}
