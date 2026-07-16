import { useEffect, useState } from "react";
import { api } from "../api.ts";
import type { Page, Version } from "../types.ts";
import { PublicationDialog } from "./PublicationDialog.tsx";

export function Editor({ pageId, onChanged }: { pageId: string; onChanged: () => void }) {
  const [page, setPage] = useState<Page | null>(null);
  const [history, setHistory] = useState<Version[]>([]);
  const [draft, setDraft] = useState({ path: "", title: "", body_markdown: "" });
  const [commit, setCommit] = useState("");
  const [tab, setTab] = useState<"edit" | "preview" | "history" | "links">("edit");
  const [publishing, setPublishing] = useState(false);
  const [message, setMessage] = useState("");

  const load = async () => {
    const next = await api<Page>(`/api/dashboard/pages/${pageId}`);
    setPage(next);
    setDraft({ path: next.current_path, title: next.title, body_markdown: next.body_markdown });
    setHistory(await api<Version[]>(`/api/dashboard/pages/${pageId}/history`));
  };
  useEffect(() => { load().catch((error: Error) => setMessage(error.message)); }, [pageId]);

  if (!page) return <main className="editor-empty">{message || "Loading page…"}</main>;

  const save = async () => {
    setMessage("");
    try {
      await api(`/api/dashboard/pages/${page.id}`, {
        method: "PUT",
        body: JSON.stringify({ ...draft, commit_message: commit, expected_version_number: page.version_number }),
      });
      setCommit("");
      await load();
      onChanged();
      setMessage("Saved as a new immutable version.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Save failed"); }
  };

  const restore = async (version: Version) => {
    const commitMessage = window.prompt(`Commit message for restoring version ${version.version_number}`);
    if (!commitMessage) return;
    await api(`/api/dashboard/pages/${page.id}/restore`, {
      method: "POST",
      body: JSON.stringify({ version_number: version.version_number, commit_message: commitMessage, expected_version_number: page.version_number }),
    });
    await load(); onChanged();
  };

  const archive = async () => {
    const commitMessage = window.prompt("Commit message for archiving this page");
    if (!commitMessage) return;
    try {
      await api(`/api/dashboard/pages/${page.id}/archive`, {
        method: "POST",
        body: JSON.stringify({ commit_message: commitMessage, expected_version_number: page.version_number }),
      });
      await load(); onChanged(); setMessage("Page archived as a new immutable version.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Archive failed"); }
  };

  return <main className="editor">
    <header className="editor-header">
      <div><span className="path">{page.current_path}</span><h1>{page.title}</h1></div>
      <div className="button-row"><span className={page.published_version_id ? "status public" : "status"}>{page.archived_at ? "Archived" : page.published_version_id ? `Public · ${page.public_slug}` : "Private"}</span>{!page.archived_at && <button onClick={archive}>Archive</button>}{!page.archived_at && <button onClick={() => setPublishing(true)}>{page.published_version_id ? "Visibility" : "Publish"}</button>}</div>
    </header>
    <nav className="tabs">{(["edit", "preview", "history", "links"] as const).map((item) => <button className={tab === item ? "active" : ""} key={item} onClick={() => setTab(item)}>{item}</button>)}</nav>
    {tab === "edit" && <section className="edit-grid">
      <div className="editor-fields"><label>Path<input value={draft.path} onChange={(event) => setDraft({ ...draft, path: event.target.value })} /></label><label>Title<input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label></div>
      <textarea className="markdown-editor" value={draft.body_markdown} onChange={(event) => setDraft({ ...draft, body_markdown: event.target.value })} spellCheck />
      <footer className="save-bar"><input placeholder="Describe this change (required)" value={commit} onChange={(event) => setCommit(event.target.value)} /><button className="primary" disabled={commit.trim().length < 3} onClick={save}>Save version</button></footer>
    </section>}
    {tab === "preview" && <article className="rendered" dangerouslySetInnerHTML={{ __html: page.rendered_html ?? "" }} />}
    {tab === "history" && <section className="history-list">{history.map((version) => <article key={version.id}><div><strong>v{version.version_number} · {version.commit_message}</strong><span>{version.actor_kind} · {new Date(version.created_at).toLocaleString()}</span></div><button onClick={() => restore(version)}>Restore</button></article>)}</section>}
    {tab === "links" && <section className="links-grid"><div><h3>Outgoing</h3>{page.outgoing?.map((link) => <a href={`/app/pages/${link.id}`} key={link.id}>{link.title}<span>{link.current_path}</span></a>)}</div><div><h3>Backlinks</h3>{page.backlinks?.map((link) => <a href={`/app/pages/${link.id}`} key={link.id}>{link.title}<span>{link.current_path}</span></a>)}</div></section>}
    {message && <div className="toast">{message}</div>}
    {publishing && <PublicationDialog page={page} onClose={() => setPublishing(false)} onChanged={load} />}
  </main>;
}
