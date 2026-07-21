import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { api, refreshCsrf } from "./api.ts";
import { authClient } from "./auth-client.ts";
import { AssetDetails } from "./components/Assets.tsx";
import { Automations } from "./components/Automations.tsx";
import { Editor } from "./components/Editor.tsx";
import { DirectoryEditor } from "./components/DirectoryEditor.tsx";
import { KnowledgeTree, type KnowledgeSelection } from "./components/KnowledgeTree.tsx";
import { Login } from "./components/Login.tsx";
import { McpClients } from "./components/McpClients.tsx";
import { OAuthConsent } from "./components/OAuthConsent.tsx";
import { Settings, type PasskeySummary } from "./components/Settings.tsx";
import type { Asset, Directory, Page } from "./types.ts";

type SessionInfo = { owner: { id: string; email: string }; passkey_count: number; passkeys: PasskeySummary[] };
type Section = "knowledge" | "automations" | "mcp" | "settings";

const SIDEBAR_WIDTH_STORAGE_KEY = "context-use.sidebar.width.v1";
const DEFAULT_SIDEBAR_WIDTH = 258;
const MIN_SIDEBAR_WIDTH = 220;
const MAX_SIDEBAR_WIDTH = 520;

const clampSidebarWidth = (width: number) => Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, width));

function restoredSidebarWidth() {
  try {
    const stored = Number(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY));
    return Number.isFinite(stored) && stored > 0 ? clampSidebarWidth(stored) : DEFAULT_SIDEBAR_WIDTH;
  } catch {
    return DEFAULT_SIDEBAR_WIDTH;
  }
}

function SectionIcon({ section }: { section: Section }) {
  if (section === "knowledge") return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 3.5h8a3 3 0 0 1 3 3v10h-8a3 3 0 0 1-3-3v-10Z" /><path d="M7.5 6.5h5M7.5 9.5h5M7.5 12.5h3" /></svg>;
  if (section === "automations") return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3.25A6.75 6.75 0 1 0 16.75 10" /><path d="M10 6v4l2.75 1.5M14 3.25h2.75V6" /></svg>;
  if (section === "mcp") return <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="5" cy="6" r="2" /><circle cx="15" cy="6" r="2" /><circle cx="10" cy="15" r="2" /><path d="m6.75 7 2.2 5.25M13.25 7l-2.2 5.25M7 6h6" /></svg>;
  return <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="2.5" /><path d="M16.5 11.5v-3l-2-.5a5.1 5.1 0 0 0-.7-1.2l.55-2-2.6-1.5-1.45 1.45a5.3 5.3 0 0 0-1.4 0L7.45 3.3l-2.6 1.5.55 2A5.1 5.1 0 0 0 4.7 8l-2 .5v3l2 .5c.18.43.42.84.7 1.2l-.55 2 2.6 1.5 1.45-1.45a5.3 5.3 0 0 0 1.4 0l1.45 1.45 2.6-1.5-.55-2c.28-.36.52-.77.7-1.2l2-.5Z" /></svg>;
}

function SignOutIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8 3.5H4.5v13H8" /><path d="M11.5 6.5 15 10l-3.5 3.5M7 10h8" /></svg>;
}

function selectionFromLocation(): KnowledgeSelection | null {
  const match = window.location.pathname.match(/^\/app\/(pages|directories|assets)\/([0-9a-f-]+)/);
  if (!match) return null;
  return { kind: match[1] === "pages" ? "page" : match[1] === "directories" ? "directory" : "asset", id: match[2]! };
}

function sectionFromLocation(): Section {
  if (window.location.pathname === "/app/settings") return "settings";
  if (window.location.pathname === "/app/automations") return "automations";
  if (window.location.pathname === "/app/mcp") return "mcp";
  return "knowledge";
}

export function App() {
  const { data: authSession, isPending } = authClient.useSession();
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [directories, setDirectories] = useState<Directory[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selected, setSelected] = useState<KnowledgeSelection | null>(selectionFromLocation);
  const [section, setSection] = useState<Section>(sectionFromLocation);
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(restoredSidebarWidth);
  const [resizingSidebar, setResizingSidebar] = useState(false);
  const [message, setMessage] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const sidebarResizeStart = useRef({ pointerX: 0, width: DEFAULT_SIDEBAR_WIDTH });
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
  const loadDirectories = async () => {
    const parameters = new URLSearchParams();
    if (query) parameters.set("q", query);
    setDirectories(await api<Directory[]>(`/api/dashboard/directories${parameters.size ? `?${parameters}` : ""}`));
  };
  useEffect(() => { if (authSession) loadSession().catch(() => setSession(null)); }, [authSession]);
  useEffect(() => { if (session) loadPages().catch(() => undefined); }, [session, query, showArchived]);
  useEffect(() => { if (session) loadAssets().catch(() => undefined); }, [session]);
  useEffect(() => { if (session) loadDirectories().catch(() => undefined); }, [session, query]);
  useEffect(() => {
    const syncLocation = () => {
      setSelected(selectionFromLocation());
      setSection(sectionFromLocation());
    };
    window.addEventListener("popstate", syncLocation);
    return () => window.removeEventListener("popstate", syncLocation);
  }, []);
  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      window.setTimeout(() => { searchRef.current?.focus(); searchRef.current?.select(); });
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth));
    } catch {
      // Resizing still works when browser storage is unavailable.
    }
  }, [sidebarWidth]);

  useEffect(() => {
    if (!resizingSidebar) return;
    const resize = (event: PointerEvent) => {
      const delta = event.clientX - sidebarResizeStart.current.pointerX;
      setSidebarWidth(clampSidebarWidth(sidebarResizeStart.current.width + delta));
    };
    const stop = () => setResizingSidebar(false);
    document.body.classList.add("resizing-sidebar");
    window.addEventListener("pointermove", resize);
    window.addEventListener("pointerup", stop, { once: true });
    window.addEventListener("pointercancel", stop, { once: true });
    return () => {
      document.body.classList.remove("resizing-sidebar");
      window.removeEventListener("pointermove", resize);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [resizingSidebar]);

  const visibleAssets = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return normalized
      ? assets.filter((asset) => `${asset.current_path} ${asset.filename}`.toLocaleLowerCase().includes(normalized))
      : assets;
  }, [assets, query]);
  const selectedAsset = selected?.kind === "asset" ? assets.find((asset) => asset.id === selected.id) ?? null : null;

  if (isPending) return <main className="center-card">Loading…</main>;
  if (!authSession) return <Login />;
  if (consent) return <OAuthConsent />;
  if (!session) return <main className="center-card">Verifying owner session…</main>;
  if (session.passkey_count === 0) return <main className="center-card"><h1>Owner passkey missing</h1><p>This session cannot access an installation without its permanent owner passkey.</p></main>;

  const selectKnowledge = (selection: KnowledgeSelection) => {
    setSelected(selection);
    setSection("knowledge");
    const collection = selection.kind === "page" ? "pages" : selection.kind === "directory" ? "directories" : "assets";
    history.pushState({}, "", `/app/${collection}/${selection.id}`);
  };

  const openSettings = () => {
    setSection("settings");
    if (window.location.pathname !== "/app/settings") history.pushState({}, "", "/app/settings");
  };

  const openAutomations = () => {
    setSection("automations");
    history.pushState({}, "", "/app/automations");
  };

  const openMcpClients = () => {
    setSection("mcp");
    history.pushState({}, "", "/app/mcp");
  };

  const openKnowledge = () => {
    setSection("knowledge");
    const collection = selected?.kind === "page" ? "pages" : selected?.kind === "directory" ? "directories" : "assets";
    history.pushState({}, "", selected ? `/app/${collection}/${selected.id}` : "/app");
  };

  const startSidebarResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    sidebarResizeStart.current = { pointerX: event.clientX, width: sidebarWidth };
    setResizingSidebar(true);
    event.preventDefault();
  };

  const resizeSidebarWithKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 30 : 10;
    if (event.key === "ArrowLeft") setSidebarWidth((width) => clampSidebarWidth(width - step));
    else if (event.key === "ArrowRight") setSidebarWidth((width) => clampSidebarWidth(width + step));
    else if (event.key === "Home") setSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
    else return;
    event.preventDefault();
  };

  return <div className="shell" style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}>
    <aside className="sidebar">
      <div className="sidebar-brand"><div className="brand-mark small">cu</div><div><strong>context-use</strong><span>Private workspace</span></div></div>
      <nav className="sidebar-section-nav">
        <button className={`mobile-knowledge-nav${section === "knowledge" ? " active" : ""}`} onClick={openKnowledge}><SectionIcon section="knowledge" /><span>Knowledge</span></button>
        <button className={section === "automations" ? "active" : ""} onClick={openAutomations}><SectionIcon section="automations" /><span>Automations</span></button>
        <button className={section === "mcp" ? "active" : ""} onClick={openMcpClients}><SectionIcon section="mcp" /><span>MCP clients</span></button>
      </nav>
      <label className="sidebar-search"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5" /><path d="m12.25 12.25 4 4" /></svg><input ref={searchRef} className="search" aria-label="Search knowledge" placeholder="Search knowledge…" value={query} onChange={(event) => setQuery(event.target.value)} /><kbd>⌘K</kbd></label>
      <KnowledgeTree pages={pages} directories={directories} assets={visibleAssets} query={query} selected={section === "knowledge" ? selected : null} onSelect={selectKnowledge} />
      <label className="archive-toggle"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />Include archived pages</label>
      <footer>
        <button className={section === "settings" ? "settings-button active" : "settings-button"} onClick={openSettings}><SectionIcon section="settings" /><span>Settings</span></button>
        <div className="sidebar-account"><span className="user-avatar">{session.owner.email.slice(0, 1).toUpperCase()}</span><span className="sidebar-user"><strong>{session.owner.email}</strong><small>{session.passkey_count} secure passkey{session.passkey_count === 1 ? "" : "s"}</small></span><button type="button" className="sign-out-button" onClick={() => authClient.signOut({ fetchOptions: { onSuccess: () => location.assign("/app") } })}><SignOutIcon /><span>Sign out</span></button></div>
      </footer>
    </aside>
    <div
      className="sidebar-resizer"
      role="separator"
      aria-label="Resize sidebar"
      aria-orientation="vertical"
      aria-valuemin={MIN_SIDEBAR_WIDTH}
      aria-valuemax={MAX_SIDEBAR_WIDTH}
      aria-valuenow={sidebarWidth}
      tabIndex={0}
      onPointerDown={startSidebarResize}
      onKeyDown={resizeSidebarWithKeyboard}
      onDoubleClick={() => setSidebarWidth(DEFAULT_SIDEBAR_WIDTH)}
    />
    {section === "settings" ? <Settings passkeys={session.passkeys} /> : section === "automations" ? <Automations /> : section === "mcp" ? <McpClients /> : selected?.kind === "page" ? <Editor pageId={selected.id} onChanged={loadPages} onDeleted={async () => { setSelected(null); history.pushState({}, "", "/app"); await loadPages(); setMessage("Page and retained version history permanently deleted from the live knowledge base."); }} /> : selected?.kind === "directory" ? <DirectoryEditor directoryId={selected.id} onChanged={loadDirectories} onSelect={selectKnowledge} /> : selectedAsset ? <AssetDetails key={selectedAsset.id} asset={selectedAsset} onChanged={loadAssets} onDeleted={async () => { setSelected(null); history.pushState({}, "", "/app"); await loadAssets(); setMessage("Asset deleted. S3 versioning retains a recoverable noncurrent copy for the configured safety period."); }} /> : <main className="editor-empty"><div className="empty-content"><span className="empty-kicker"><i />Private by default</span><h1>Your context,<br />ready when you need it.</h1><p>Browse durable knowledge managed through your authenticated MCP connection. Your content stays private until you explicitly publish an exact version.</p><div className="empty-details"><span>Markdown-native</span><span>Versioned history</span><span>Agent-managed</span></div></div><div className="empty-sigil" aria-hidden="true"><span>c</span><span>u</span></div></main>}
    {message && <div className="toast">{message}</div>}
  </div>;
}
