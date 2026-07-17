import { useEffect, useMemo, useState } from "react";
import { api, refreshCsrf, uploadFile } from "./api.ts";
import { authClient } from "./auth-client.ts";
import { AssetDetails } from "./components/Assets.tsx";
import { Editor } from "./components/Editor.tsx";
import { KnowledgeTree, type KnowledgeSelection } from "./components/KnowledgeTree.tsx";
import { Login } from "./components/Login.tsx";
import { OAuthConsent } from "./components/OAuthConsent.tsx";
import { Security, type PasskeySummary } from "./components/Security.tsx";
import type { Asset, Page } from "./types.ts";

type SessionInfo = { owner: { id: string; email: string }; passkey_count: number; passkeys: PasskeySummary[] };

function selectionFromLocation(): KnowledgeSelection | null {
  const match = window.location.pathname.match(/^\/app\/(pages|assets)\/([0-9a-f-]+)/);
  return match ? { kind: match[1] === "pages" ? "page" : "asset", id: match[2]! } : null;
}

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function App() {
  const { data: authSession, isPending } = authClient.useSession();
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selected, setSelected] = useState<KnowledgeSelection | null>(selectionFromLocation);
  const [section, setSection] = useState<"knowledge" | "security">("knowledge");
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | "page" | "asset">("all");
  const [showArchived, setShowArchived] = useState(false);
  const [message, setMessage] = useState("");
  const consent = window.location.pathname === "/app/oauth/consent";

  const loadSession = async () => {
    const value = await api<SessionInfo>("/api/dashboard/session");
    setSession(value);
    await refreshCsrf();
  };
  const loadPages = async () => {
    const parameters = new URLSearchParams();
    if (query) parameters.set("q", query);
    if (showArchived) parameters.set("archived", "true");
    setPages(await api<Page[]>(`/api/dashboard/pages${parameters.size ? `?${parameters}` : ""}`));
  };
  const loadAssets = async () => setAssets(await api<Asset[]>("/api/dashboard/assets"));
  useEffect(() => { if (authSession) loadSession().catch(() => setSession(null)); }, [authSession]);
  useEffect(() => { if (session) loadPages().catch(() => undefined); }, [session, query, showArchived]);
  useEffect(() => { if (session) loadAssets().catch(() => undefined); }, [session]);

  const visibleAssets = useMemo(() => {
    if (kindFilter === "page") return [];
    const normalized = query.trim().toLocaleLowerCase();
    return normalized
      ? assets.filter((asset) => `${asset.current_path} ${asset.filename}`.toLocaleLowerCase().includes(normalized))
      : assets;
  }, [assets, query, kindFilter]);
  const visiblePages = kindFilter === "asset" ? [] : pages;
  const selectedAsset = selected?.kind === "asset" ? assets.find((asset) => asset.id === selected.id) ?? null : null;

  if (isPending) return <main className="center-card">Loading…</main>;
  if (!authSession) return <Login />;
  if (consent) return <OAuthConsent />;
  if (!session) return <main className="center-card">Verifying owner session…</main>;
  if (session.passkey_count === 0) return <main className="center-card"><h1>Owner passkey missing</h1><p>This session cannot access an installation without its permanent owner passkey.</p></main>;

  const createPage = async () => {
    const path = window.prompt("Page path (lowercase, e.g. notes/new-page)");
    if (!path) return;
    const title = window.prompt("Page title") ?? path.split("/").at(-1) ?? path;
    const page = await api<Page>("/api/dashboard/pages", { method: "POST", body: JSON.stringify({ path, title, body_markdown: "", commit_message: "Create page" }) });
    setSelected({ kind: "page", id: page.id }); setSection("knowledge"); await loadPages();
    history.pushState({}, "", `/app/pages/${page.id}`);
  };

  const uploadAsset = async (file: File) => {
    const path = window.prompt("Asset path (lowercase, e.g. projects/acme/site-photo)");
    if (!path) return;
    setMessage("Hashing and preparing upload…");
    try {
      const created = await api<{ asset: Asset }>("/api/dashboard/assets/upload-intent", {
        method: "POST",
        body: JSON.stringify({ path, filename: file.name, content_type: file.type || "application/octet-stream", size_bytes: file.size, sha256: await sha256(file) }),
      });
      await uploadFile(`/api/dashboard/assets/${created.asset.id}/content`, file, created.asset.content_type);
      await loadAssets();
      setSelected({ kind: "asset", id: created.asset.id });
      setSection("knowledge");
      history.pushState({}, "", `/app/assets/${created.asset.id}`);
      setMessage("Asset uploaded privately.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Upload failed"); }
  };

  const selectKnowledge = (selection: KnowledgeSelection) => {
    setSelected(selection);
    history.pushState({}, "", `/app/${selection.kind === "page" ? "pages" : "assets"}/${selection.id}`);
  };

  return <div className="shell">
    <aside className="sidebar">
      <div className="sidebar-brand"><div className="brand-mark small">cu</div><strong>context-use</strong></div>
      <div className="section-switch"><button className={section === "knowledge" ? "active" : ""} onClick={() => setSection("knowledge")}>Knowledge</button><button className={section === "security" ? "active" : ""} onClick={() => setSection("security")}>Security</button></div>
      {section === "knowledge" && <><input className="search" placeholder="Search knowledge…" value={query} onChange={(event) => setQuery(event.target.value)} /><div className="knowledge-filter">{(["all", "page", "asset"] as const).map((kind) => <button className={kindFilter === kind ? "active" : ""} key={kind} onClick={() => setKindFilter(kind)}>{kind === "all" ? "All" : `${kind}s`}</button>)}</div><label className="archive-toggle"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />Include archived pages</label><KnowledgeTree pages={visiblePages} assets={visibleAssets} query={query} selected={selected} onSelect={selectKnowledge} /><div className="knowledge-actions"><button onClick={createPage}>＋ New page</button><label className="button upload-button">↑ Upload asset<input type="file" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) uploadAsset(file); }} /></label></div></>}
      <footer><span>{session.owner.email} · {session.passkey_count} passkey{session.passkey_count === 1 ? "" : "s"}</span><button onClick={() => authClient.signOut({ fetchOptions: { onSuccess: () => location.assign("/app") } })}>Sign out</button></footer>
    </aside>
    {section === "security" ? <Security passkeys={session.passkeys} /> : selected?.kind === "page" ? <Editor pageId={selected.id} onChanged={loadPages} /> : selectedAsset ? <AssetDetails key={selectedAsset.id} asset={selectedAsset} onChanged={loadAssets} onDeleted={async () => { setSelected(null); history.pushState({}, "", "/app"); await loadAssets(); setMessage("Asset deleted. S3 versioning retains a recoverable noncurrent copy for the configured safety period."); }} /> : <main className="editor-empty"><div className="brand-mark">cu</div><h2>Select or create knowledge</h2><p>Pages and assets remain private until you explicitly publish them.</p></main>}
    {message && <div className="toast">{message}</div>}
  </div>;
}
