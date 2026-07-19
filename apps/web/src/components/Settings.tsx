import { startAuthentication } from "@simplewebauthn/browser";
import { useEffect, useState } from "react";
import { api } from "../api.ts";
import type { ConnectedClient } from "../types.ts";
import { ActionDialog } from "./ActionDialog.tsx";

export type PasskeySummary = { id: string; name: string | null; created_at: string };

type KnowledgeExportIntent = {
  intent: { id: string; expires_at: string };
  summary: { page_count: number; asset_count: number; total_bytes: number };
  authentication_options: Parameters<typeof startAuthentication>[0]["optionsJSON"];
};

export function formatExportBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = units[0]!;
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index]!;
  }
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${unit}`;
}

export function Settings({ passkeys }: { passkeys: PasskeySummary[] }) {
  const [clients, setClients] = useState<ConnectedClient[]>([]);
  const [message, setMessage] = useState("");
  const [revoking, setRevoking] = useState<ConnectedClient | null>(null);
  const [revokeWorking, setRevokeWorking] = useState(false);
  const [revokeError, setRevokeError] = useState("");
  const [exportIntent, setExportIntent] = useState<KnowledgeExportIntent | null>(null);
  const [exportPreparing, setExportPreparing] = useState(false);
  const [exportWorking, setExportWorking] = useState(false);
  const [exportError, setExportError] = useState("");
  const load = async () => {
    setClients(await api<ConnectedClient[]>("/api/dashboard/oauth-clients"));
  };

  const prepareExport = async () => {
    setExportPreparing(true);
    setExportError("");
    setMessage("");
    try {
      setExportIntent(await api<KnowledgeExportIntent>("/api/dashboard/knowledge-export-intents", {
        method: "POST",
        body: "{}",
      }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not prepare the knowledge export");
    } finally {
      setExportPreparing(false);
    }
  };

  const downloadExport = async () => {
    if (!exportIntent) return;
    setExportWorking(true);
    setExportError("");
    try {
      const response = await startAuthentication({ optionsJSON: exportIntent.authentication_options });
      const confirmed = await api<{ download_url: string }>("/api/dashboard/knowledge-exports/confirm", {
        method: "POST",
        body: JSON.stringify({ intent_id: exportIntent.intent.id, response }),
      });
      setExportIntent(null);
      setMessage("Passkey verified. Your private knowledge export is downloading.");
      window.location.assign(confirmed.download_url);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Knowledge export failed");
    } finally {
      setExportWorking(false);
    }
  };
  useEffect(() => { load().catch((error: Error) => setMessage(error.message)); }, []);

  const revoke = async (client: ConnectedClient) => {
    setRevokeWorking(true);
    setRevokeError("");
    try {
      await api(`/api/dashboard/oauth-clients/${encodeURIComponent(client.client_id)}`, { method: "DELETE" });
      setMessage("MCP client revoked.");
      await load();
      setRevoking(null);
    } catch (error) {
      setRevokeError(error instanceof Error ? error.message : "Could not revoke this client");
    } finally {
      setRevokeWorking(false);
    }
  };

  return <main className="content-page settings-page"><header><div><span className="eyebrow">Owner-only controls</span><h1>Settings</h1></div></header>
    {message && <p>{message}</p>}
    <section><h2>Owner passkey</h2><p>This credential is the only authentication, publication, and knowledge-export factor. It cannot be added, replaced, or removed after initial setup.</p><div className="security-list">{passkeys.map((key) => <article key={key.id}><div><strong>{key.name || "Passkey"}</strong><span>Added {new Date(key.created_at).toLocaleString()}</span></div></article>)}</div></section>
    <section><h2>Export knowledge</h2><p>Download the latest version of every active page and asset as a navigable Markdown vault. Private references become local links, and no publication or account metadata is included.</p><button className="primary" disabled={exportPreparing || exportWorking} onClick={() => void prepareExport()}>{exportPreparing ? "Checking assets…" : "Export with passkey"}</button></section>
    <section><h2>Connected MCP clients</h2>{clients.length === 0 ? <p>No agent is connected.</p> : <div className="security-list">{clients.map((client) => <article key={client.client_id}><div><strong>{client.name || client.client_id}</strong><span>{client.scopes.join(" · ")} · last used {client.last_used_at ? new Date(client.last_used_at).toLocaleString() : "never"}</span></div><button className="danger" onClick={() => { setRevokeError(""); setRevoking(client); }}>Revoke</button></article>)}</div>}</section>
    {exportIntent && <ActionDialog
      eyebrow="Private knowledge export"
      title="Download your knowledge base?"
      description="The ZIP contains every active private and public page and asset. It will be unencrypted on this computer. A fresh owner-passkey verification is required, and this authorization can be downloaded only once from this dashboard session."
      confirmLabel="Verify passkey and download"
      workingLabel="Waiting for passkey…"
      working={exportWorking}
      error={exportError}
      onCancel={() => { setExportError(""); setExportIntent(null); }}
      onConfirm={() => void downloadExport()}
    >
      <dl className="action-dialog-details">
        <div><dt>Pages</dt><dd>{exportIntent.summary.page_count}</dd></div>
        <div><dt>Assets</dt><dd>{exportIntent.summary.asset_count}</dd></div>
        <div><dt>Uncompressed size</dt><dd>about {formatExportBytes(exportIntent.summary.total_bytes)}</dd></div>
      </dl>
    </ActionDialog>}
    {revoking && <ActionDialog
      eyebrow="Connected client"
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
