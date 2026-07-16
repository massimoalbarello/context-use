import { useEffect, useMemo, useState } from "react";
import { startAuthentication } from "@simplewebauthn/browser";
import { api, refreshCsrf } from "./api.ts";
import { authClient } from "./auth-client.ts";
import { Assets } from "./components/Assets.tsx";
import { Editor } from "./components/Editor.tsx";
import { Login } from "./components/Login.tsx";
import { OAuthConsent } from "./components/OAuthConsent.tsx";
import { PasskeyOnboarding } from "./components/PasskeyOnboarding.tsx";
import { Security, type PasskeySummary } from "./components/Security.tsx";
import type { Page } from "./types.ts";

type SessionInfo = { owner: { id: string; email: string }; passkey_count: number; passkeys: PasskeySummary[] };

export function App() {
  const { data: authSession, isPending } = authClient.useSession();
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [selected, setSelected] = useState<string | null>(() => window.location.pathname.match(/^\/app\/pages\/([0-9a-f-]+)/)?.[1] ?? null);
  const [section, setSection] = useState<"pages" | "assets" | "security">("pages");
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const consent = window.location.pathname === "/app/oauth/consent";
  const recoveryToken = window.location.pathname === "/app/recover-passkey" ? new URLSearchParams(window.location.search).get("token") ?? undefined : undefined;

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
  useEffect(() => { if (authSession) loadSession().catch(() => setSession(null)); }, [authSession]);
  useEffect(() => { if (session) loadPages().catch(() => undefined); }, [session, query, showArchived]);

  const tree = useMemo(() => pages, [pages]);
  if (isPending) return <main className="center-card">Loading…</main>;
  if (!authSession) return <Login />;
  if (consent) return <OAuthConsent />;
  if (!session) return <main className="center-card">Verifying owner session…</main>;
  if (session.passkey_count === 0 || recoveryToken) return <PasskeyOnboarding onComplete={() => { history.replaceState({}, "", "/app"); loadSession(); }} {...(recoveryToken ? { recoveryToken } : {})} />;

  const createPage = async () => {
    const path = window.prompt("Page path (lowercase, e.g. notes/new-page)");
    if (!path) return;
    const title = window.prompt("Page title") ?? path.split("/").at(-1) ?? path;
    const page = await api<Page>("/api/dashboard/pages", { method: "POST", body: JSON.stringify({ path, title, body_markdown: "", commit_message: "Create page" }) });
    setSelected(page.id); setSection("pages"); await loadPages();
    history.pushState({}, "", `/app/pages/${page.id}`);
  };

  const addRecoveryPasskey = async () => {
    const created = await api<{ intent: { id: string }; authentication_options: Parameters<typeof startAuthentication>[0]["optionsJSON"] }>("/api/dashboard/passkey-management/intents", {
      method: "POST", body: JSON.stringify({ action: "add_passkey" }),
    });
    const response = await startAuthentication({ optionsJSON: created.authentication_options });
    const grant = await api<{ management_token: string }>("/api/dashboard/passkey-management/confirm", {
      method: "POST", body: JSON.stringify({ intent_id: created.intent.id, response }),
    });
    const added = await authClient.passkey.addPasskey({
      name: "Recovery passkey",
      fetchOptions: { headers: { "x-passkey-management-token": grant.management_token } },
    });
    if (added.error) throw new Error(added.error.message ?? "Could not add passkey");
    await loadSession();
    window.alert("Recovery passkey added.");
  };

  return <div className="shell">
    <aside className="sidebar">
      <div className="sidebar-brand"><div className="brand-mark small">cu</div><strong>context-use</strong></div>
      <div className="section-switch"><button className={section === "pages" ? "active" : ""} onClick={() => setSection("pages")}>Knowledge</button><button className={section === "assets" ? "active" : ""} onClick={() => setSection("assets")}>Assets</button><button className={section === "security" ? "active" : ""} onClick={() => setSection("security")}>Security</button></div>
      {section === "pages" && <><input className="search" placeholder="Search knowledge…" value={query} onChange={(event) => setQuery(event.target.value)} /><label className="archive-toggle"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />Include archived</label><div className="page-tree">{tree.map((page) => <button className={`${selected === page.id ? "selected" : ""} ${page.archived_at ? "archived" : ""}`} key={page.id} onClick={() => { setSelected(page.id); history.pushState({}, "", `/app/pages/${page.id}`); }}><span>{page.current_path}</span><strong>{page.title}</strong>{page.archived_at ? <i>archived</i> : page.published_version_id && <i>public</i>}</button>)}</div><button className="new-page" onClick={createPage}>＋ New page</button></>}
      <footer><span>{session.owner.email} · {session.passkey_count} passkey{session.passkey_count === 1 ? "" : "s"}</span><button onClick={() => addRecoveryPasskey().catch((error: Error) => alert(error.message))}>Add recovery passkey</button><button onClick={() => authClient.signOut({ fetchOptions: { onSuccess: () => location.assign("/app") } })}>Sign out</button></footer>
    </aside>
    {section === "assets" ? <Assets /> : section === "security" ? <Security passkeys={session.passkeys} onPasskeysChanged={loadSession} /> : selected ? <Editor pageId={selected} onChanged={loadPages} /> : <main className="editor-empty"><div className="brand-mark">cu</div><h2>Select or create a page</h2><p>Your knowledge remains private until you explicitly publish an exact version.</p></main>}
  </div>;
}
