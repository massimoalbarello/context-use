import { useEffect, useState } from "react";
import { api } from "../api.ts";
import { confirmPageDeletion } from "../page-deletion-auth.ts";
import { confirmPublicationChange } from "../publication-auth.ts";
import { isPublishedPageOutdated } from "../publication-status.ts";
import type { Page, Version } from "../types.ts";
import { ActionDialog } from "./ActionDialog.tsx";
import { PublicationDialog } from "./PublicationDialog.tsx";

export function Editor({
  pageId,
  onChanged,
  onDeleted,
}: {
  pageId: string;
  onChanged: () => Promise<void> | void;
  onDeleted: () => Promise<void> | void;
}) {
  const [page, setPage] = useState<Page | null>(null);
  const [history, setHistory] = useState<Version[]>([]);
  const [draft, setDraft] = useState({ path: "", title: "", summary: "", body_markdown: "" });
  const [commit, setCommit] = useState("");
  const [tab, setTab] = useState<"preview" | "history">("preview");
  const [isEditing, setIsEditing] = useState(false);
  const [publishingVersion, setPublishingVersion] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveCommit, setArchiveCommit] = useState("");
  const [archiveWorking, setArchiveWorking] = useState(false);
  const [archiveError, setArchiveError] = useState("");
  const [unpublishWorking, setUnpublishWorking] = useState(false);
  const [deletionOpen, setDeletionOpen] = useState(false);
  const [deletionWorking, setDeletionWorking] = useState(false);
  const [deletionError, setDeletionError] = useState("");

  const load = async (preserveDraft = false) => {
    const [next, versions] = await Promise.all([
      api<Page>(`/api/dashboard/pages/${pageId}`),
      api<Version[]>(`/api/dashboard/pages/${pageId}/history`),
    ]);
    setPage(next);
    if (!preserveDraft) setDraft({ path: next.current_path, title: next.title, summary: next.summary, body_markdown: next.body_markdown });
    setHistory(versions);
    return { page: next, history: versions };
  };

  useEffect(() => {
    setPage(null);
    setHistory([]);
    setCommit("");
    setMessage("");
    setPublishingVersion(null);
    setArchiveOpen(false);
    setArchiveCommit("");
    setArchiveError("");
    setUnpublishWorking(false);
    setDeletionOpen(false);
    setDeletionWorking(false);
    setDeletionError("");
    setTab("preview");
    setIsEditing(false);
    load().catch((error: Error) => setMessage(error.message));
  }, [pageId]);

  useEffect(() => {
    if (!page?.rendered_html || tab !== "preview" || isEditing || !window.location.hash) return;
    let fragment: string;
    try {
      fragment = decodeURIComponent(window.location.hash.slice(1));
    } catch {
      return;
    }
    const frame = window.requestAnimationFrame(() => document.getElementById(fragment)?.scrollIntoView());
    return () => window.cancelAnimationFrame(frame);
  }, [page?.rendered_html, tab, isEditing]);

  if (!page) return <main className="editor-empty">{message || "Loading page…"}</main>;

  const publishedVersion = history.find((version) => version.id === page.published_version_id);
  const publishedVersionNumber = publishedVersion?.version_number;
  const hasUnpublishedChanges = isPublishedPageOutdated(page);
  const automationCreated = Boolean(page.automation_id);
  const automationInstructions = page.automation_instructions;

  const edit = () => {
    setDraft({ path: page.current_path, title: page.title, summary: page.summary, body_markdown: page.body_markdown });
    setCommit("");
    setIsEditing(true);
  };

  const cancelEdit = () => {
    setDraft({ path: page.current_path, title: page.title, summary: page.summary, body_markdown: page.body_markdown });
    setCommit("");
    setIsEditing(false);
  };

  const save = async () => {
    setMessage("");
    try {
      const saved = await api<Page>(`/api/dashboard/pages/${page.id}`, {
        method: "PUT",
        body: JSON.stringify({ ...draft, commit_message: commit, expected_version_number: page.version_number }),
      });
      setCommit("");
      await load();
      onChanged();
      setIsEditing(false);
      setTab("preview");
      setMessage(page.published_version_id
        ? `Saved as v${saved.version_number}. Your public page is still v${publishedVersionNumber ?? page.version_number}; publish the new version when it is ready.`
        : `Saved as v${saved.version_number}.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Save failed"); }
  };

  const archive = async () => {
    setArchiveWorking(true);
    setArchiveError("");
    try {
      await api(`/api/dashboard/pages/${page.id}/archive`, {
        method: "POST",
        body: JSON.stringify({ commit_message: archiveCommit.trim(), expected_version_number: page.version_number }),
      });
      await load();
      onChanged();
      setArchiveOpen(false);
      setArchiveCommit("");
      setMessage("Page archived as a new immutable version.");
    } catch (error) {
      setArchiveError(error instanceof Error ? error.message : "Archive failed");
    } finally {
      setArchiveWorking(false);
    }
  };

  const publicationChanged = async (action: "publish" | "unpublish") => {
    const published = publishingVersion;
    await load(true);
    onChanged();
    setMessage(action === "unpublish" ? "The page is now private." : `v${published} is now published.`);
  };

  const unpublish = async () => {
    setUnpublishWorking(true);
    setMessage("");
    try {
      await confirmPublicationChange({
        action: "unpublish",
        targetKind: "page",
        targetId: page.id,
        versionId: null,
      });
      await publicationChanged("unpublish");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unpublishing failed");
    } finally {
      setUnpublishWorking(false);
    }
  };

  const remove = async () => {
    setDeletionWorking(true);
    setDeletionError("");
    try {
      await confirmPageDeletion(page.id);
      setDeletionOpen(false);
      await onDeleted();
    } catch (error) {
      setDeletionError(error instanceof Error ? error.message : "Page deletion failed");
    } finally {
      setDeletionWorking(false);
    }
  };

  return <main className="editor">
    <header className="editor-header">
      <div><span className="path">{page.current_path}</span><h1>{page.title}</h1><p className="knowledge-summary">{page.summary}</p></div>
      <div className="button-row">
        <span className={page.published_version_id ? "status public" : "status"}>{page.archived_at ? "Archived" : page.published_version_id ? `Public${publishedVersionNumber ? ` v${publishedVersionNumber}` : ""} · ${page.public_path}` : automationInstructions ? "Private · Automation instructions" : automationCreated ? "Private · Automation-created" : "Private"}</span>
        {page.published_version_id && page.public_path && <a className="button" href={`/p/${page.public_path}`} target="_blank" rel="noreferrer">View public ↗</a>}
        {!page.archived_at && !page.published_version_id && <button onClick={() => { setArchiveCommit(""); setArchiveError(""); setArchiveOpen(true); }}>Archive</button>}
        {page.archived_at && !automationInstructions && <button className="danger" onClick={() => { setDeletionError(""); setDeletionOpen(true); }}>Delete permanently</button>}
        {!automationInstructions && !page.archived_at && !page.published_version_id && <button className="primary" onClick={() => setPublishingVersion(page.version_number)}>Publish</button>}
        {!automationInstructions && !page.archived_at && page.published_version_id && <button className="danger" disabled={unpublishWorking} onClick={() => void unpublish()}>{unpublishWorking ? "Waiting for passkey…" : "Unpublish"}</button>}
        {!automationInstructions && !page.archived_at && page.published_version_id && hasUnpublishedChanges && <button className="primary" onClick={() => setPublishingVersion(page.version_number)}>Publish latest</button>}
      </div>
    </header>
    {hasUnpublishedChanges && <div className="publication-notice pending publication-alert" role="status">
      <div>
        <strong>Published page is not up to date</strong>
        <span>v{publishedVersionNumber ?? "?"} is public, while v{page.version_number} is the latest version available.</span>
      </div>
    </div>}
    {!isEditing && <nav className="tabs">
      <div>{(["preview", "history"] as const).map((item) => <button className={tab === item ? "active" : ""} key={item} onClick={() => setTab(item)}>{item}</button>)}</div>
      {tab === "preview" && <button className="edit-page-button" onClick={edit} aria-label="Edit page">
        <svg aria-hidden="true" viewBox="0 0 16 16"><path d="M11.7 2.3a1 1 0 0 1 1.4 0l.6.6a1 1 0 0 1 0 1.4l-8 8-3.2.7.7-3.2 8-8Z" /><path d="m9.8 4.2 2 2" /></svg>
        Edit
      </button>}
    </nav>}
    {!isEditing && automationInstructions && <div className="automation-owned-notice"><strong>Automation instructions</strong><span>This page can be edited and versioned like other knowledge, but it is permanently private. It can also be managed from Automations or by a valid run claim.</span></div>}
    {!isEditing && automationCreated && !automationInstructions && <div className="automation-owned-notice"><strong>Created by an automation</strong><span>This page now follows the same lifecycle as any other page: edit or archive it here, and publish only after dashboard passkey confirmation.</span></div>}
    {isEditing && <section className="edit-grid">
      <div className="edit-top">
        {page.published_version_id && !hasUnpublishedChanges && <div className="publication-notice">
          <div>
            <strong>v{publishedVersionNumber ?? page.version_number} is currently public.</strong>
            <span>Saving edits creates a new private version. The published page will not update automatically.</span>
          </div>
        </div>}
        <div className="editor-fields"><label>Path<input value={draft.path} onChange={(event) => setDraft({ ...draft, path: event.target.value })} /></label><label>Title<input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label><label className="summary-field">Summary<input maxLength={320} required value={draft.summary} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} /></label></div>
      </div>
      <textarea className="markdown-editor" value={draft.body_markdown} onChange={(event) => setDraft({ ...draft, body_markdown: event.target.value })} spellCheck />
      <footer className="save-bar"><input placeholder="Describe this change (required)" value={commit} onChange={(event) => setCommit(event.target.value)} /><div className="button-row"><button onClick={cancelEdit}>Cancel</button><button className="primary" disabled={commit.trim().length < 3 || !draft.summary.trim()} onClick={save}>Save version</button></div></footer>
    </section>}
    {!isEditing && tab === "preview" && <article className="rendered" dangerouslySetInnerHTML={{ __html: page.rendered_html ?? "" }} />}
    {!isEditing && tab === "history" && <section className="history-list">
      <header><h2>Version history</h2><p>The latest editable version and the published version are independent. Publishing points the public URL at one exact snapshot.</p></header>
      {history.map((version) => {
        const isLatest = version.id === page.current_version_id;
        const isPublished = version.id === page.published_version_id;
        return <article className={isPublished ? "published-version" : ""} key={version.id}>
          <div className="version-info">
            <div className="version-heading"><strong>v{version.version_number}</strong>{isLatest && <span className="version-badge latest">Latest</span>}{isPublished && <span className="version-badge published">Published</span>}</div>
            <span className="commit-message">{version.commit_message}</span>
            <span>{version.actor_kind} · {new Date(version.created_at).toLocaleString()}</span>
          </div>
          {!automationInstructions && !page.archived_at && <div className="version-actions">
            {isPublished && page.public_path && <a className="button" href={`/p/${page.public_path}`} target="_blank" rel="noreferrer">View public</a>}
            {isPublished
              ? <button className="danger" disabled={unpublishWorking} onClick={() => void unpublish()}>{unpublishWorking ? "Waiting for passkey…" : "Unpublish"}</button>
              : <button className={isLatest ? "primary" : ""} onClick={() => setPublishingVersion(version.version_number)}>Publish this version</button>}
          </div>}
        </article>;
      })}
    </section>}
    {message && <div className="toast">{message}</div>}
    {archiveOpen && <ActionDialog
      eyebrow="Immutable version"
      title={`Archive ${page.title}?`}
      description="Archiving creates one final immutable version and removes this page from the active knowledge tree."
      confirmLabel="Archive page"
      workingLabel="Archiving…"
      working={archiveWorking}
      confirmDisabled={archiveCommit.trim().length < 3}
      focusCancel={false}
      error={archiveError}
      onCancel={() => setArchiveOpen(false)}
      onConfirm={() => void archive()}
    >
      <label>Commit message<input autoFocus value={archiveCommit} onChange={(event) => setArchiveCommit(event.target.value)} placeholder="Why is this page being archived?" onKeyDown={(event) => {
        if (event.key === "Enter" && archiveCommit.trim().length >= 3 && !archiveWorking) void archive();
      }} /></label>
    </ActionDialog>}
    {deletionOpen && <ActionDialog
      eyebrow="Permanent action"
      title={`Delete ${page.title}?`}
      description={`This permanently deletes the page and all ${history.length} retained version${history.length === 1 ? "" : "s"} from the live knowledge base. It cannot be undone from the dashboard; existing encrypted backups expire under the configured retention policy. A fresh owner-passkey verification is required.`}
      confirmLabel="Delete permanently with passkey"
      workingLabel="Waiting for passkey…"
      confirmTone="danger"
      working={deletionWorking}
      error={deletionError}
      onCancel={() => setDeletionOpen(false)}
      onConfirm={() => void remove()}
    />}
    {publishingVersion != null && <PublicationDialog page={page} versionNumber={publishingVersion} publishedVersionNumber={publishedVersionNumber} onClose={() => setPublishingVersion(null)} onChanged={publicationChanged} />}
  </main>;
}
