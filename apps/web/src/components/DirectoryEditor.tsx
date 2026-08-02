import { useEffect, useState } from "react";
import { api } from "../api.ts";
import type { DirectoryIndex, DirectoryIndexEntry } from "../types.ts";
import { ActionDialog } from "./ActionDialog.tsx";
import type { KnowledgeSelection } from "./KnowledgeTree.tsx";

export function selectionForDirectoryEntry(child: DirectoryIndexEntry): KnowledgeSelection {
  return child.kind === "directory" && child.default_page_id
    ? { kind: "page", id: child.default_page_id }
    : { kind: child.kind, id: child.id };
}

export function DirectoryEditor({
  directoryId,
  onChanged,
  onDeleted,
  onSelect,
}: {
  directoryId: string;
  onChanged: () => Promise<void> | void;
  onDeleted: () => Promise<void> | void;
  onSelect: (selection: KnowledgeSelection) => void;
}) {
  const [directory, setDirectory] = useState<DirectoryIndex | null>(null);
  const [draft, setDraft] = useState({ title: "", summary: "" });
  const [isEditing, setIsEditing] = useState(false);
  const [message, setMessage] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const load = async () => {
    const next = await api<DirectoryIndex>(`/api/dashboard/directories/${directoryId}`);
    setDirectory(next);
    setDraft({ title: next.title, summary: next.summary });
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
      setMessage("Directory presentation saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed");
    }
  };

  const startEditing = () => {
    setDraft({ title: directory.title, summary: directory.summary });
    setIsEditing(true);
  };

  const remove = async () => {
    setDeleting(true);
    setDeleteError("");
    try {
      await api(`/api/dashboard/directories/${directory.id}`, {
        method: "DELETE",
        body: JSON.stringify({ expected_version_number: directory.version_number }),
      });
      setShowDelete(false);
      await onDeleted();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Deletion failed");
    } finally {
      setDeleting(false);
    }
  };

  return <main className="editor directory-editor">
    <header className="editor-header">
      <div>
        <span className="path">{directory.current_path || "/"}</span>
        <h1>{directory.title}</h1>
        {directory.summary && <p className="knowledge-summary">{directory.summary}</p>}
      </div>
      {!isEditing && <div className="button-row">
        {directory.guide && <button onClick={() => onSelect({ kind: "page", id: directory.guide!.id })}>Instructions</button>}
        <button className="primary" onClick={startEditing}>Edit presentation</button>
        {directory.current_path && <button className="danger" onClick={() => { setDeleteError(""); setShowDelete(true); }}>Delete directory</button>}
      </div>}
    </header>

    {isEditing ? <section className="edit-grid directory-edit-grid">
      <div className="edit-top">
        <div className="editor-fields">
          <label>Path<input value={directory.current_path || "/"} disabled /></label>
          <label>Public listing title<input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
          <label className="summary-field">Public listing summary (optional)<input maxLength={320} value={draft.summary} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} /></label>
        </div>
      </div>
      <footer className="save-bar"><span>These fields describe this folder in its parent's public index.</span><div className="button-row"><button onClick={() => setIsEditing(false)}>Cancel</button><button className="primary" disabled={!draft.title.trim()} onClick={() => void save()}>Save presentation</button></div></footer>
    </section> : <>
      <section className="directory-index" aria-label={`${directory.title} contents`}>
        {directory.children.length ? <ol>
          {directory.children.map((child) => <li key={`${child.kind}-${child.id}`}>
            <button type="button" onClick={() => onSelect(selectionForDirectoryEntry(child))}>{child.title}</button>
            {child.summary && <span>— {child.summary}</span>}
          </li>)}
        </ol> : <p className="directory-empty">This directory has no child pages or directories yet.</p>}
      </section>
    </>}
    {message && <div className="toast">{message}</div>}
    {showDelete && <ActionDialog
      eyebrow="Permanent action"
      title={`Delete ${directory.title}?`}
      description={<>This removes only <code>{directory.current_path}</code>. It will be refused if any active or archived pages, assets, or child directories remain inside.</>}
      confirmLabel="Delete empty directory"
      workingLabel="Deleting…"
      confirmTone="danger"
      working={deleting}
      error={deleteError}
      onCancel={() => setShowDelete(false)}
      onConfirm={() => void remove()}
    />}
  </main>;
}
