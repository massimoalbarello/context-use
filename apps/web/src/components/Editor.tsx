import { useEffect, useState } from "react";
import { api } from "../api.ts";
import { confirmPageDeletion } from "../page-deletion-auth.ts";
import { confirmPublicationChange } from "../publication-auth.ts";
import { isPublishedPageOutdated } from "../publication-status.ts";
import type { Page, PageVersionDiff, Version } from "../types.ts";
import { ActionDialog } from "./ActionDialog.tsx";
import { PublicationDialog } from "./PublicationDialog.tsx";

const diffFieldLabels: Record<PageVersionDiff["metadata_changes"][number]["field"], string> = {
  path: "Path",
  title: "Title",
  summary: "Summary",
};

export function VersionDiffContents({ diff }: { diff: PageVersionDiff }) {
  const hasChanges = diff.metadata_changes.length > 0 || diff.markdown_changes.length > 0;
  if (!hasChanges) return <p className="version-diff-empty">No page-content changes in this version.</p>;

  return <div className="version-diff-contents">
    {diff.metadata_changes.length > 0 && <section className="version-diff-section">
      <h4>Page details</h4>
      {diff.metadata_changes.map((change) => <div className="version-diff-field" key={change.field}>
        <strong>{diffFieldLabels[change.field]}</strong>
        {change.before !== null && <pre className="diff-value removed"><span aria-hidden="true">−</span>{change.before}</pre>}
        <pre className="diff-value added"><span aria-hidden="true">+</span>{change.after}</pre>
      </div>)}
    </section>}
    {diff.markdown_changes.length > 0 && <section className="version-diff-section">
      <h4>Page content</h4>
      {diff.markdown_changes.map((change, index) => <div className="markdown-change" key={index}>
        {change.before && <pre className="diff-value removed"><span aria-hidden="true">−</span>{change.before}</pre>}
        {change.after && <pre className="diff-value added"><span aria-hidden="true">+</span>{change.after}</pre>}
      </div>)}
    </section>}
  </div>;
}

function VersionComparison({
  pageId,
  versionNumber,
  previousVersionNumber,
}: {
  pageId: string;
  versionNumber: number;
  previousVersionNumber: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [diff, setDiff] = useState<PageVersionDiff | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const panelId = `version-${versionNumber}-diff`;
  const label = previousVersionNumber === null ? "View initial content" : `Changes from v${previousVersionNumber}`;

  const toggle = async () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (diff || loading) return;
    setLoading(true);
    setError("");
    try {
      const from = previousVersionNumber === null ? "" : `?from=${previousVersionNumber}`;
      setDiff(await api<PageVersionDiff>(`/api/dashboard/pages/${pageId}/versions/${versionNumber}/diff${from}`));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Comparison failed");
    } finally {
      setLoading(false);
    }
  };

  return <div className="version-comparison">
    <button className="version-diff-toggle" aria-expanded={open} aria-controls={panelId} onClick={() => void toggle()}>
      <svg aria-hidden="true" viewBox="0 0 16 16"><path d="m5 6 3 3 3-3" /></svg>
      {label}
    </button>
    {open && <div className="version-diff-panel" id={panelId}>
      {loading && <p className="version-diff-status" role="status">Loading changes…</p>}
      {error && <p className="version-diff-error" role="alert">{error}</p>}
      {diff && <VersionDiffContents diff={diff} />}
    </div>}
  </div>;
}

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
  const currentVersion = history.find((version) => version.id === page.current_version_id);
  const lastEditedAt = currentVersion?.created_at ?? page.updated_at;
  const hasUnpublishedChanges = isPublishedPageOutdated(page);

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
      <div><span className="path">{page.current_path}</span><h1>{page.title}</h1><p className="knowledge-summary">{page.summary}</p><time className="page-last-edited" dateTime={new Date(lastEditedAt).toISOString()}>Last edited {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(lastEditedAt))}</time></div>
      <div className="button-row">
        <span className={page.published_version_id ? "status public" : "status"}>{page.archived_at ? "Archived" : page.published_version_id ? `Public${publishedVersionNumber ? ` v${publishedVersionNumber}` : ""} · ${page.public_path}` : "Private"}</span>
        {page.published_version_id && page.public_path && <a className="button" href={`/p/${page.public_path}`} target="_blank" rel="noreferrer">View public ↗</a>}
        {!page.archived_at && !page.published_version_id && <button onClick={() => { setArchiveCommit(""); setArchiveError(""); setArchiveOpen(true); }}>Archive</button>}
        {page.archived_at && <button className="danger" onClick={() => { setDeletionError(""); setDeletionOpen(true); }}>Delete permanently</button>}
        {!page.archived_at && !page.published_version_id && <button className="primary" onClick={() => setPublishingVersion(page.version_number)}>Publish</button>}
        {!page.archived_at && page.published_version_id && <button className="danger" disabled={unpublishWorking} onClick={() => void unpublish()}>{unpublishWorking ? "Waiting for passkey…" : "Unpublish"}</button>}
        {!page.archived_at && page.published_version_id && hasUnpublishedChanges && <button className="primary" onClick={() => setPublishingVersion(page.version_number)}>Publish latest</button>}
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
      {history.map((version, index) => {
        const isLatest = version.id === page.current_version_id;
        const isPublished = version.id === page.published_version_id;
        const previousVersionNumber = history[index + 1]?.version_number ?? null;
        const canCompare = previousVersionNumber !== null || version.version_number === 1;
        return <article className={isPublished ? "published-version" : ""} key={version.id}>
          <div className="version-row">
            <div className="version-info">
              <div className="version-heading"><strong>v{version.version_number}</strong>{isLatest && <span className="version-badge latest">Latest</span>}{isPublished && <span className="version-badge published">Published</span>}</div>
              <span className="commit-message">{version.commit_message}</span>
              <span>{version.actor_kind} · {new Date(version.created_at).toLocaleString()}</span>
            </div>
            {!page.archived_at && <div className="version-actions">
              {isPublished && page.public_path && <a className="button" href={`/p/${page.public_path}`} target="_blank" rel="noreferrer">View public</a>}
              {isPublished
                ? <button className="danger" disabled={unpublishWorking} onClick={() => void unpublish()}>{unpublishWorking ? "Waiting for passkey…" : "Unpublish"}</button>
                : <button className={isLatest ? "primary" : ""} onClick={() => setPublishingVersion(version.version_number)}>Publish this version</button>}
            </div>}
          </div>
          {canCompare && <VersionComparison pageId={page.id} versionNumber={version.version_number} previousVersionNumber={previousVersionNumber} />}
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
