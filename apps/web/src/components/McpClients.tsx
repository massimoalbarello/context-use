import { useEffect, useState } from "react";
import { api } from "../api.ts";
import type { ConnectedClient, PaginatedResponse } from "../types.ts";
import { ActionDialog } from "./ActionDialog.tsx";

const PAGE_SIZE = 10;

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "Never";
}

export function McpClients() {
  const [endpoint, setEndpoint] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<PaginatedResponse<ConnectedClient> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [revoking, setRevoking] = useState<ConnectedClient | null>(null);
  const [revokeWorking, setRevokeWorking] = useState(false);
  const [revokeError, setRevokeError] = useState("");

  useEffect(() => {
    api<{ url: string }>("/api/dashboard/mcp-endpoint")
      .then(({ url }) => setEndpoint(url))
      .catch((cause: Error) => setError(cause.message));
  }, []);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setResult(null);
    setError("");
    api<PaginatedResponse<ConnectedClient>>(
      `/api/dashboard/private-mcp-clients?page=${page}&page_size=${PAGE_SIZE}`,
    ).then((response) => {
      if (current) setResult(response);
    }).catch((cause: Error) => {
      if (current) setError(cause.message);
    }).finally(() => {
      if (current) setLoading(false);
    });
    return () => { current = false; };
  }, [page, refreshKey]);

  const copyUrl = async () => {
    setError("");
    try {
      await navigator.clipboard.writeText(endpoint);
      setMessage("Private MCP URL copied.");
    } catch {
      setError("Could not copy the URL. Select it and copy it manually.");
    }
  };

  const revoke = async (client: ConnectedClient) => {
    setRevokeWorking(true);
    setRevokeError("");
    try {
      await api(`/api/dashboard/oauth-clients/${encodeURIComponent(client.client_id)}`, { method: "DELETE" });
      setRevoking(null);
      setMessage("Private MCP client revoked.");
      if ((result?.items.length ?? 0) === 1 && page > 1) setPage((current) => current - 1);
      else setRefreshKey((current) => current + 1);
    } catch (cause) {
      setRevokeError(cause instanceof Error ? cause.message : "Could not revoke this client");
    } finally {
      setRevokeWorking(false);
    }
  };

  const clients = result?.items ?? [];
  const totalPages = Math.max(1, result?.total_pages ?? 0);

  return <main className="content-page mcp-clients-page">
    <header><div><span className="eyebrow">Agent connections</span><h1>MCP clients</h1><p>Connect agents to private tools with owner authorization and review the clients that currently have access.</p></div></header>
    {message && <div className="mcp-message" role="status">{message}</div>}
    {error && <div className="mcp-message error" role="alert">{error}</div>}

    <section className="mcp-endpoint-section">
      <div className="section-heading"><div><h2>Private server URL</h2><p>Paste this endpoint into any client that supports remote MCP servers. The client will ask you to authorize access through OAuth.</p></div></div>
      <article className="mcp-endpoint-card">
        <span className="mcp-access-badge private">Private</span>
        <div className="mcp-endpoint-copy"><code>{endpoint || "Loading…"}</code><button type="button" disabled={!endpoint} onClick={() => void copyUrl()}>Copy URL</button></div>
      </article>
    </section>

    <section className="mcp-client-section">
      <div className="mcp-client-heading"><div><h2>Connected clients</h2><p>Clients you authorized to access private tools.</p></div></div>

      {loading ? <p className="mcp-empty">Loading clients…</p> : clients.length === 0 ? <p className="mcp-empty">No MCP client has connected yet.</p> : <div className="mcp-client-list">{clients.map((client) => <article key={client.client_id}>
        <div className="mcp-client-main"><div className="mcp-client-title"><strong>{client.name || client.client_id}</strong><span className="mcp-access-badge private">Private</span></div><span>{client.version ? `Version ${client.version} · ` : ""}Approved {formatDate(client.approved_at)}</span><span>Last used {formatDate(client.last_used_at)}</span><div className="mcp-scope-list">{client.scopes.map((scope) => <code key={scope}>{scope}</code>)}</div></div>
        <button type="button" className="danger" onClick={() => { setRevokeError(""); setRevoking(client); }}>Revoke</button>
      </article>)}</div>}

      {!loading && result && result.total > 0 && <div className="mcp-pagination" aria-label="Client list pagination">
        <span>Showing {(result.page - 1) * result.page_size + 1}–{Math.min(result.page * result.page_size, result.total)} of {result.total}</span>
        <div><button type="button" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button><span>Page {page} of {totalPages}</span><button type="button" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)}>Next</button></div>
      </div>}
    </section>

    {revoking && <ActionDialog
      eyebrow="Private MCP client"
      title={`Revoke ${revoking.name ?? revoking.client_id}?`}
      description="Its consent and refresh tokens will stop working immediately. The client will need to connect and be authorized again to regain access."
      confirmLabel="Revoke access"
      workingLabel="Revoking…"
      confirmTone="danger"
      working={revokeWorking}
      error={revokeError}
      onCancel={() => setRevoking(null)}
      onConfirm={() => void revoke(revoking)}
    />}
  </main>;
}
