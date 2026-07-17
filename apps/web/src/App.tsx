import { useEffect, useMemo, useState } from "react";
import { api, refreshCsrf, uploadFile } from "./api.ts";
import { authClient } from "./auth-client.ts";
import { AssetDetails } from "./components/Assets.tsx";
import { Editor } from "./components/Editor.tsx";
import { KnowledgeTree, type KnowledgeSelection } from "./components/KnowledgeTree.tsx";
import { Login } from "./components/Login.tsx";
import { OAuthConsent } from "./components/OAuthConsent.tsx";
import { Settings, type PasskeySummary } from "./components/Settings.tsx";
import type { Asset, Page } from "./types.ts";

type SessionInfo = { owner: { id: string; email: string }; passkey_count: number; passkeys: PasskeySummary[] };
type Section = "knowledge" | "settings";

function selectionFromLocation(): KnowledgeSelection | null {
  const match = window.location.pathname.match(/^\/app\/(pages|assets)\/([0-9a-f-]+)/);
  return match ? { kind: match[1] === "pages" ? "page" : "asset", id: match[2]! } : null;
}

function sectionFromLocation(): Section {
  return window.location.pathname === "/app/settings" ? "settings" : "knowledge";
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
  const [section, setSection] = useState<Section>(sectionFromLocation);
  const [query, setQuery] = useState("");
  const [publicationFilter, setPublicationFilter] = useState<"all" | "public">("all");
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
  useEffect(() => {
    const syncLocation = () => {
      setSelected(selectionFromLocation());
      setSection(sectionFromLocation());
    };
    window.addEventListener("popstate", syncLocation);
    return () => window.removeEventListener("popstate", syncLocation);
  }, []);

  const visibleAssets = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    const matchingAssets = normalized
      ? assets.filter((asset) => `${asset.current_path} ${asset.filename}`.toLocaleLowerCase().includes(normalized))
      : assets;
    return publicationFilter === "public"
      ? matchingAssets.filter((asset) => Boolean(asset.published_at))
      : matchingAssets;
  }, [assets, query, publicationFilter]);
  const visiblePages = useMemo(() => publicationFilter === "public"
    ? pages.filter((page) => Boolean(page.published_version_id))
    : pages, [pages, publicationFilter]);
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
    setSection("knowledge");
    history.pushState({}, "", `/app/${selection.kind === "page" ? "pages" : "assets"}/${selection.id}`);
  };

  const openSettings = () => {
    setSection("settings");
    if (window.location.pathname !== "/app/settings") history.pushState({}, "", "/app/settings");
  };

  return <div className="shell">
    <aside className="sidebar">
      <div className="sidebar-brand"><div className="brand-mark small">cu</div><strong>context-use</strong></div>
      <input className="search" placeholder="Search knowledge…" value={query} onChange={(event) => setQuery(event.target.value)} />
      <div className="knowledge-filter" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>{(["all", "public"] as const).map((filter) => <button className={publicationFilter === filter ? "active" : ""} aria-pressed={publicationFilter === filter} key={filter} onClick={() => setPublicationFilter(filter)}>{filter === "all" ? "All" : "Public"}</button>)}</div>
      <label className="archive-toggle"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />Include archived pages</label>
      <KnowledgeTree pages={visiblePages} assets={visibleAssets} query={query} selected={selected} onSelect={selectKnowledge} emptyMessage={publicationFilter === "public" ? "Nothing public yet" : "No knowledge yet"} />
      <div className="knowledge-actions"><button onClick={createPage}>＋ New page</button><label className="button upload-button">↑ Upload asset<input type="file" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) uploadAsset(file); }} /></label></div>
      <footer>
        <span className="sidebar-user">{session.owner.email} · {session.passkey_count} passkey{session.passkey_count === 1 ? "" : "s"}</span>
        <div className="sidebar-footer-actions">
          <button className={section === "settings" ? "settings-button active" : "settings-button"} onClick={openSettings} aria-label="Open settings">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08A1.7 1.7 0 0 0 8.94 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.57 15 1.7 1.7 0 0 0 3 14H3v-4h.08A1.7 1.7 0 0 0 4.6 8.94a1.7 1.7 0 0 0-.34-1.88L4.2 7l2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.57 1.7 1.7 0 0 0 10 3h4v.08a1.7 1.7 0 0 0 1.06 1.52 1.7 1.7 0 0 0 1.88-.34L17 4.2 19.83 7l-.06.06a1.7 1.7 0 0 0-.34 1.88A1.7 1.7 0 0 0 21 10h.08v4H21a1.7 1.7 0 0 0-1.6 1Z" /></svg>
            Settings
          </button>
          <button onClick={() => authClient.signOut({ fetchOptions: { onSuccess: () => location.assign("/app") } })}>Sign out</button>
        </div>
      </footer>
    </aside>
    {section === "settings" ? <Settings passkeys={session.passkeys} /> : selected?.kind === "page" ? <Editor pageId={selected.id} onChanged={loadPages} /> : selectedAsset ? <AssetDetails key={selectedAsset.id} asset={selectedAsset} onChanged={loadAssets} onDeleted={async () => { setSelected(null); history.pushState({}, "", "/app"); await loadAssets(); setMessage("Asset deleted. S3 versioning retains a recoverable noncurrent copy for the configured safety period."); }} /> : <main className="editor-empty"><div className="brand-mark">cu</div><h2>Select or create knowledge</h2><p>Pages and assets remain private until you explicitly publish them.</p></main>}
    {message && <div className="toast">{message}</div>}
  </div>;
}
