import { useEffect, useMemo, useRef, useState } from "react";
import { api, refreshCsrf } from "./api.ts";
import { authClient } from "./auth-client.ts";
import { AssetDetails } from "./components/Assets.tsx";
import { Automations } from "./components/Automations.tsx";
import { Editor } from "./components/Editor.tsx";
import { KnowledgeTree, type KnowledgeSelection } from "./components/KnowledgeTree.tsx";
import { Login } from "./components/Login.tsx";
import { Messages } from "./components/Messages.tsx";
import { OAuthConsent } from "./components/OAuthConsent.tsx";
import { Settings, type PasskeySummary } from "./components/Settings.tsx";
import { Skills } from "./components/Skills.tsx";
import { filterPagesByPublication, isPublishedPageOutdated, type PublicationFilter } from "./publication-status.ts";
import type { Asset, Page } from "./types.ts";

type SessionInfo = { owner: { id: string; email: string }; passkey_count: number; passkeys: PasskeySummary[] };
type Section = "knowledge" | "messages" | "skills" | "automations" | "settings";

function SectionIcon({ section }: { section: Section }) {
  if (section === "knowledge") return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 3.5h8a3 3 0 0 1 3 3v10h-8a3 3 0 0 1-3-3v-10Z" /><path d="M7.5 6.5h5M7.5 9.5h5M7.5 12.5h3" /></svg>;
  if (section === "messages") return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 4.5h13v9h-8l-3.5 3v-3H3.5v-9Z" /><path d="M6.5 7.5h7M6.5 10.5h4.5" /></svg>;
  if (section === "skills") return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m10 2 1.25 4.25L15.5 7.5l-4.25 1.25L10 13l-1.25-4.25L4.5 7.5l4.25-1.25L10 2Z" /><path d="m15.5 12 .65 2.35L18.5 15l-2.35.65L15.5 18l-.65-2.35L12.5 15l2.35-.65L15.5 12Z" /></svg>;
  if (section === "automations") return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3.25A6.75 6.75 0 1 0 16.75 10" /><path d="M10 6v4l2.75 1.5M14 3.25h2.75V6" /></svg>;
  return <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="2.5" /><path d="M16.5 11.5v-3l-2-.5a5.1 5.1 0 0 0-.7-1.2l.55-2-2.6-1.5-1.45 1.45a5.3 5.3 0 0 0-1.4 0L7.45 3.3l-2.6 1.5.55 2A5.1 5.1 0 0 0 4.7 8l-2 .5v3l2 .5c.18.43.42.84.7 1.2l-.55 2 2.6 1.5 1.45-1.45a5.3 5.3 0 0 0 1.4 0l1.45 1.45 2.6-1.5-.55-2c.28-.36.52-.77.7-1.2l2-.5Z" /></svg>;
}

function selectionFromLocation(): KnowledgeSelection | null {
  const match = window.location.pathname.match(/^\/app\/(pages|assets)\/([0-9a-f-]+)/);
  return match ? { kind: match[1] === "pages" ? "page" : "asset", id: match[2]! } : null;
}

function sectionFromLocation(): Section {
  if (window.location.pathname === "/app/settings") return "settings";
  if (window.location.pathname === "/app/messages") return "messages";
  if (window.location.pathname === "/app/skills") return "skills";
  if (window.location.pathname === "/app/automations") return "automations";
  return "knowledge";
}

export function App() {
  const { data: authSession, isPending } = authClient.useSession();
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selected, setSelected] = useState<KnowledgeSelection | null>(selectionFromLocation);
  const [section, setSection] = useState<Section>(sectionFromLocation);
  const [query, setQuery] = useState("");
  const [publicationFilter, setPublicationFilter] = useState<PublicationFilter>("all");
  const [showArchived, setShowArchived] = useState(false);
  const [message, setMessage] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
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
  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      if (section !== "knowledge") {
        setSection("knowledge");
        history.pushState({}, "", selected ? `/app/${selected.kind === "page" ? "pages" : "assets"}/${selected.id}` : "/app");
      }
      window.setTimeout(() => { searchRef.current?.focus(); searchRef.current?.select(); });
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, [section, selected]);

  const visibleAssets = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    const matchingAssets = normalized
      ? assets.filter((asset) => `${asset.current_path} ${asset.filename}`.toLocaleLowerCase().includes(normalized))
      : assets;
    return publicationFilter === "public"
      ? matchingAssets.filter((asset) => Boolean(asset.published_at))
      : publicationFilter === "updates" ? [] : matchingAssets;
  }, [assets, query, publicationFilter]);
  const visiblePages = useMemo(() => filterPagesByPublication(pages, publicationFilter), [pages, publicationFilter]);
  const outdatedPublicationCount = useMemo(() => pages.filter(isPublishedPageOutdated).length, [pages]);
  const selectedAsset = selected?.kind === "asset" ? assets.find((asset) => asset.id === selected.id) ?? null : null;

  if (isPending) return <main className="center-card">Loading…</main>;
  if (!authSession) return <Login />;
  if (consent) return <OAuthConsent />;
  if (!session) return <main className="center-card">Verifying owner session…</main>;
  if (session.passkey_count === 0) return <main className="center-card"><h1>Owner passkey missing</h1><p>This session cannot access an installation without its permanent owner passkey.</p></main>;

  const selectKnowledge = (selection: KnowledgeSelection) => {
    setSelected(selection);
    setSection("knowledge");
    history.pushState({}, "", `/app/${selection.kind === "page" ? "pages" : "assets"}/${selection.id}`);
  };

  const openSettings = () => {
    setSection("settings");
    if (window.location.pathname !== "/app/settings") history.pushState({}, "", "/app/settings");
  };

  const openMessages = () => {
    setSection("messages");
    history.pushState({}, "", "/app/messages");
  };

  const openAutomations = () => {
    setSection("automations");
    history.pushState({}, "", "/app/automations");
  };

  const openSkills = () => {
    setSection("skills");
    history.pushState({}, "", "/app/skills");
  };

  const openKnowledge = () => {
    setSection("knowledge");
    history.pushState({}, "", selected ? `/app/${selected.kind === "page" ? "pages" : "assets"}/${selected.id}` : "/app");
  };

  return <div className="shell">
    <aside className="sidebar">
      <div className="sidebar-brand"><div className="brand-mark small">cu</div><div><strong>context-use</strong><span>Private workspace</span></div></div>
      <nav className="sidebar-section-nav">
        <button className={section === "knowledge" ? "active" : ""} onClick={openKnowledge}><SectionIcon section="knowledge" /><span>Knowledge</span></button>
        <button className={section === "messages" ? "active" : ""} onClick={openMessages}><SectionIcon section="messages" /><span>Messages</span></button>
        <button className={section === "skills" ? "active" : ""} onClick={openSkills}><SectionIcon section="skills" /><span>Skills</span></button>
        <button className={section === "automations" ? "active" : ""} onClick={openAutomations}><SectionIcon section="automations" /><span>Automations</span></button>
      </nav>
      {section === "knowledge" ? <><label className="sidebar-search"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5" /><path d="m12.25 12.25 4 4" /></svg><input ref={searchRef} className="search" aria-label="Search knowledge" placeholder="Search knowledge…" value={query} onChange={(event) => setQuery(event.target.value)} /><kbd>⌘K</kbd></label>
        <div className="knowledge-filter" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>{(["all", "public", "updates"] as const).map((filter) => <button className={publicationFilter === filter ? "active" : ""} aria-pressed={publicationFilter === filter} key={filter} onClick={() => setPublicationFilter(filter)}>{filter === "all" ? "All" : filter === "public" ? "Public" : `Updates${outdatedPublicationCount ? ` (${outdatedPublicationCount})` : ""}`}</button>)}</div>
        <label className="archive-toggle"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />Include archived pages</label>
        <KnowledgeTree pages={visiblePages} assets={visibleAssets} query={query} selected={selected} onSelect={selectKnowledge} emptyMessage={publicationFilter === "public" ? "Nothing public yet" : publicationFilter === "updates" ? "Published pages are up to date" : "No knowledge yet"} /></> : <div className="sidebar-section-summary"><span className="summary-index">0{section === "messages" ? "2" : section === "skills" ? "3" : section === "automations" ? "4" : "5"}</span><strong>{section === "messages" ? "Private outreach" : section === "automations" ? "Scheduled work" : section === "skills" ? "Reusable capabilities" : "Owner controls"}</strong><p>{section === "messages" ? "Confidential messages and sender loopback details from your public MCP." : section === "automations" ? "Versioned instructions, cron triggers, isolated generated knowledge, and durable run history." : section === "skills" ? "Discoverable SKILL.md definitions for agent-selected work." : "Manage the permanent passkey and connected agents."}</p></div>}
      <footer>
        <button className={section === "settings" ? "settings-button active" : "settings-button"} onClick={openSettings}><SectionIcon section="settings" /><span>Settings</span></button>
        <div className="sidebar-account"><span className="user-avatar">{session.owner.email.slice(0, 1).toUpperCase()}</span><span className="sidebar-user"><strong>{session.owner.email}</strong><small>{session.passkey_count} secure passkey{session.passkey_count === 1 ? "" : "s"}</small></span><button className="sign-out-button" aria-label="Sign out" title="Sign out" onClick={() => authClient.signOut({ fetchOptions: { onSuccess: () => location.assign("/app") } })}>↗</button></div>
      </footer>
    </aside>
    {section === "settings" ? <Settings passkeys={session.passkeys} /> : section === "messages" ? <Messages /> : section === "skills" ? <Skills /> : section === "automations" ? <Automations /> : selected?.kind === "page" ? <Editor pageId={selected.id} onChanged={loadPages} /> : selectedAsset ? <AssetDetails key={selectedAsset.id} asset={selectedAsset} onChanged={loadAssets} onDeleted={async () => { setSelected(null); history.pushState({}, "", "/app"); await loadAssets(); setMessage("Asset deleted. S3 versioning retains a recoverable noncurrent copy for the configured safety period."); }} /> : <main className="editor-empty"><div className="empty-content"><span className="empty-kicker"><i />Private by default</span><h1>Your context,<br />ready when you need it.</h1><p>Browse durable knowledge managed through your authenticated MCP connection. Your content stays private until you explicitly publish an exact version.</p><div className="empty-details"><span>Markdown-native</span><span>Versioned history</span><span>Agent-managed</span></div></div><div className="empty-sigil" aria-hidden="true"><span>c</span><span>u</span></div></main>}
    {message && <div className="toast">{message}</div>}
  </div>;
}
