import { useEffect, useState } from "react";
import { api } from "../api.ts";
import type { ConnectedClient } from "../types.ts";

export type PasskeySummary = { id: string; name: string | null; created_at: string };

export function Settings({ passkeys }: { passkeys: PasskeySummary[] }) {
  const [clients, setClients] = useState<ConnectedClient[]>([]);
  const [message, setMessage] = useState("");
  const load = async () => {
    setClients(await api<ConnectedClient[]>("/api/dashboard/oauth-clients"));
  };
  useEffect(() => { load().catch((error: Error) => setMessage(error.message)); }, []);

  const revoke = async (client: ConnectedClient) => {
    if (!confirm(`Revoke ${client.name ?? client.client_id}? Its consent and refresh tokens will stop working immediately.`)) return;
    await api(`/api/dashboard/oauth-clients/${encodeURIComponent(client.client_id)}`, { method: "DELETE" });
    setMessage("MCP client revoked."); await load();
  };

  return <main className="content-page settings-page"><header><div><span className="eyebrow">Owner-only controls</span><h1>Settings</h1></div></header>
    {message && <p>{message}</p>}
    <section><h2>Owner passkey</h2><p>This credential is the only authentication and publication factor. It cannot be added, replaced, or removed after initial setup.</p><div className="security-list">{passkeys.map((key) => <article key={key.id}><div><strong>{key.name || "Passkey"}</strong><span>Added {new Date(key.created_at).toLocaleString()}</span></div></article>)}</div></section>
    <section><h2>Connected MCP clients</h2>{clients.length === 0 ? <p>No agent is connected.</p> : <div className="security-list">{clients.map((client) => <article key={client.client_id}><div><strong>{client.name || client.client_id}</strong><span>{client.scopes.join(" · ")} · last used {client.last_used_at ? new Date(client.last_used_at).toLocaleString() : "never"}</span></div><button className="danger" onClick={() => revoke(client).catch((error: Error) => setMessage(error.message))}>Revoke</button></article>)}</div>}</section>
  </main>;
}
