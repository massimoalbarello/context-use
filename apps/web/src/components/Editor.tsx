import { useEffect, useState } from "react";
import { api } from "../api.ts";
import { isPublishedPageOutdated } from "../publication-status.ts";
import type { Page, Version } from "../types.ts";
import { ActionDialog } from "./ActionDialog.tsx";
import { PublicationDialog } from "./PublicationDialog.tsx";

export function Editor({ pageId, onChanged }: { pageId: string; onChanged: () => void }) {
  const [page, setPage] = useState<Page | null>(null);
  const [history, setHistory] = useState<Version[]>([]);
  const [draft, setDraft] = useState({ path: "", title: "", body_markdown: "" });
  const [commit, setCommit] = useState("");
  const [tab, setTab] = useState<"preview" | "history">("preview");
  const [isEditing, setIsEditing] = useState(false);
  const [publishingVersion, setPublishingVersion] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveCommit, setArchiveCommit] = useState("");
  const [archiveWorking, setArchiveWorking] = useState(false);
  const [archiveError, setArchiveError] = useState("");

  const load = async (preserveDraft = false) => {
    const [next, versions] = await Promise.all([
      api<Page>(`/api/dashboard/pages/${pageId}`),
      api<Version[]>(`/api/dashboard/pages/${pageId}/history`),
    ]);
    setPage(next);
    if (!preserveDraft) setDraft({ path: next.current_path, title: next.title, body_markdown: next.body_markdown });
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
    setTab("preview");
    setIsEditing(false);
    load().catch((error: Error) => setMessage(error.message));
  }, [pageId]);

  if (!page) return <main className="editor-empty">{message || "Loading page…"}</main>;

  const publishedVersion = history.find((version) => version.id === page.published_version_id);
  const publishedVersionNumber = publishedVersion?.version_number;
  const hasUnpublishedChanges = isPublishedPageOutdated(page);
  const automationOwned = Boolean(page.automation_id);

  const edit = () => {
    setDraft({ path: page.current_path, title: page.title, body_markdown: page.body_markdown });
    setCommit("");
    setIsEditing(true);
  };

  const cancelEdit = () => {
    setDraft({ path: page.current_path, title: page.title, body_markdown: page.body_markdown });
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

  const publicationChanged = async (action: "publish" | "republish" | "unpublish") => {
    const published = publishingVersion;
    await load(true);
    onChanged();
    setMessage(action === "unpublish" ? "The page is now private." : `v${published} is now published.`);
  };

  return <main className="editor">
    <header className="editor-header">
      <div><span className="path">{page.current_path}</span><h1>{page.title}</h1></div>
      <div className="button-row">
        <span className={page.published_version_id ? "status public" : "status"}>{page.archived_at ? "Archived" : automationOwned ? "Automation-owned" : page.published_version_id ? `Public${publishedVersionNumber ? ` v${publishedVersionNumber}` : ""} · ${page.public_path}` : "Private"}</span>
        {!automationOwned && !page.archived_at && !page.published_version_id && <button onClick={() => { setArchiveCommit(""); setArchiveError(""); setArchiveOpen(true); }}>Archive</button>}
        {!automationOwned && !page.archived_at && !page.published_version_id && <button className="primary" onClick={() => setPublishingVersion(page.version_number)}>Publish</button>}
        {!automationOwned && !page.archived_at && page.published_version_id && hasUnpublishedChanges && publishedVersionNumber && <button onClick={() => setPublishingVersion(publishedVersionNumber)}>Manage public v{publishedVersionNumber}</button>}
        {!automationOwned && !page.archived_at && page.published_version_id && hasUnpublishedChanges && <button className="primary" onClick={() => setPublishingVersion(page.version_number)}>Publish latest</button>}
        {!automationOwned && !page.archived_at && page.published_version_id && !hasUnpublishedChanges && <button onClick={() => setPublishingVersion(page.version_number)}>Manage publication</button>}
      </div>
    </header>
    {hasUnpublishedChanges && <div className="publication-notice pending publication-alert" role="status">
      <div>
        <strong>Published page is not up to date</strong>
        <span>v{publishedVersionNumber ?? "?"} is public, while v{page.version_number} is the latest version available.</span>
      </div>
      {!automationOwned && !page.archived_at && <button className="primary" onClick={() => setPublishingVersion(page.version_number)}>Review and publish latest</button>}
    </div>}
    {!isEditing && <nav className="tabs">
      <div>{(["preview", "history"] as const).map((item) => <button className={tab === item ? "active" : ""} key={item} onClick={() => setTab(item)}>{item}</button>)}</div>
      {tab === "preview" && !automationOwned && <button className="edit-page-button" onClick={edit} aria-label="Edit page">
        <svg aria-hidden="true" viewBox="0 0 16 16"><path d="M11.7 2.3a1 1 0 0 1 1.4 0l.6.6a1 1 0 0 1 0 1.4l-8 8-3.2.7.7-3.2 8-8Z" /><path d="m9.8 4.2 2 2" /></svg>
        Edit
      </button>}
    </nav>}
    {!isEditing && automationOwned && <div className="automation-owned-notice"><strong>Managed by an automation</strong><span>This page is private and read-only here. Only a valid run claim for its owning automation can update or archive it.</span></div>}
    {isEditing && <section className="edit-grid">
      <div className="edit-top">
        {page.published_version_id && !hasUnpublishedChanges && <div className="publication-notice">
          <div>
            <strong>v{publishedVersionNumber ?? page.version_number} is currently public.</strong>
            <span>Saving edits creates a new private version. The published page will not update automatically.</span>
          </div>
        </div>}
        <div className="editor-fields"><label>Path<input value={draft.path} onChange={(event) => setDraft({ ...draft, path: event.target.value })} /></label><label>Title<input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label></div>
      </div>
      <textarea className="markdown-editor" value={draft.body_markdown} onChange={(event) => setDraft({ ...draft, body_markdown: event.target.value })} spellCheck />
      <footer className="save-bar"><input placeholder="Describe this change (required)" value={commit} onChange={(event) => setCommit(event.target.value)} /><div className="button-row"><button onClick={cancelEdit}>Cancel</button><button className="primary" disabled={commit.trim().length < 3} onClick={save}>Save version</button></div></footer>
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
          {!automationOwned && !page.archived_at && <div className="version-actions">
            {isPublished && page.public_path && <a className="button" href={`/p/${page.public_path}`} target="_blank" rel="noreferrer">View public</a>}
            {isPublished
              ? <button onClick={() => setPublishingVersion(version.version_number)}>Manage</button>
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
    {publishingVersion != null && <PublicationDialog page={page} versionNumber={publishingVersion} publishedVersionNumber={publishedVersionNumber} onClose={() => setPublishingVersion(null)} onChanged={publicationChanged} />}
  </main>;
}
