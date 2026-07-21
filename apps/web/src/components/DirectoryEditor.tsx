import { useEffect, useState } from "react";
import { api } from "../api.ts";
import type { DirectoryIndex } from "../types.ts";
import type { KnowledgeSelection } from "./KnowledgeTree.tsx";

export function DirectoryEditor({
  directoryId,
  onChanged,
  onSelect,
}: {
  directoryId: string;
  onChanged: () => Promise<void> | void;
  onSelect: (selection: KnowledgeSelection) => void;
}) {
  const [directory, setDirectory] = useState<DirectoryIndex | null>(null);
  const [draft, setDraft] = useState({ title: "", summary: "", intro_markdown: "" });
  const [isEditing, setIsEditing] = useState(false);
  const [message, setMessage] = useState("");

  const load = async () => {
    const next = await api<DirectoryIndex>(`/api/dashboard/directories/${directoryId}`);
    setDirectory(next);
    setDraft({ title: next.title, summary: next.summary, intro_markdown: next.intro_markdown });
    return next;
  };

  useEffect(() => {
    setDirectory(null);
    setIsEditing(false);
    setMessage("");
    load().catch((error: Error) => setMessage(error.message));
  }, [directoryId]);

  if (!directory) return <main className="editor-empty">{message || "Loading directory…"}</main>;

  const save = async () => {
    setMessage("");
    try {
      await api(`/api/dashboard/directories/${directory.id}`, {
        method: "PUT",
        body: JSON.stringify({ ...draft, expected_version_number: directory.version_number }),
      });
      await load();
      await onChanged();
      setIsEditing(false);
      setMessage("Directory metadata saved. Its generated index is already up to date.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed");
    }
  };

  const startEditing = () => {
    setDraft({ title: directory.title, summary: directory.summary, intro_markdown: directory.intro_markdown });
    setIsEditing(true);
  };

  return <main className="editor directory-editor">
    <header className="editor-header">
      <div>
        <span className="path">{directory.current_path ? `${directory.current_path}/index` : "index"}</span>
        <h1>{directory.title}</h1>
        <p className="knowledge-summary">{directory.summary}</p>
      </div>
      {!isEditing && <div className="button-row"><span className="status">Generated index</span><button className="primary" onClick={startEditing}>Edit metadata</button></div>}
    </header>

    {isEditing ? <section className="edit-grid directory-edit-grid">
      <div className="edit-top">
        <div className="editor-fields">
          <label>Path<input value={directory.current_path || "/"} disabled /></label>
          <label>Title<input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
          <label className="summary-field">Summary<input maxLength={320} required value={draft.summary} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} /></label>
        </div>
      </div>
      <textarea className="markdown-editor" aria-label="Directory introduction" placeholder="Optional Markdown introduction" value={draft.intro_markdown} onChange={(event) => setDraft({ ...draft, intro_markdown: event.target.value })} spellCheck />
      <footer className="save-bar"><span>The child listing is generated automatically.</span><div className="button-row"><button onClick={() => setIsEditing(false)}>Cancel</button><button className="primary" disabled={!draft.title.trim() || !draft.summary.trim()} onClick={() => void save()}>Save metadata</button></div></footer>
    </section> : <>
      {directory.rendered_intro_html && <article className="rendered directory-intro" dangerouslySetInnerHTML={{ __html: directory.rendered_intro_html }} />}
      <section className="directory-index" aria-label={`${directory.title} contents`}>
        {directory.children.length ? <ol>
          {directory.children.map((child) => <li key={`${child.kind}-${child.id}`}>
            <button type="button" onClick={() => onSelect({ kind: child.kind, id: child.id })}>{child.title}</button>
            <span>— {child.summary}</span>
          </li>)}
        </ol> : <p className="directory-empty">This directory has no child pages or directories yet.</p>}
      </section>
    </>}
    {message && <div className="toast">{message}</div>}
  </main>;
}
