import { useEffect, useState } from "react";
import { api } from "../api.ts";
import { confirmPublicationChange } from "../publication-auth.ts";
import type { Page, PublicationPreview, RepublicationReview as Review } from "../types.ts";

const FIELD_LABELS: Record<Review["metadata_changes"][number]["field"], string> = {
  path: "Path",
  title: "Title",
  summary: "Summary",
};

function versionAuthor(version: Review["queued_versions"][number]): string {
  if (version.actor_kind === "mcp") {
    return `MCP client${version.actor_subject ? ` · ${version.actor_subject}` : ""}`;
  }
  return version.actor_kind === "dashboard" ? "You, in the dashboard" : "context-use";
}

export function republicationChanged(review: Review): boolean {
  return review.metadata_changes.length > 0 || review.markdown_changes.length > 0;
}

/**
 * The republication decision, stated as a diff rather than as a page.
 *
 * A published page keeps serving its pinned version while later edits accumulate privately,
 * so republishing exposes all of them at once. Read whole, the candidate page looks familiar
 * and gets approved; what needs review is only the part that changed, and who wrote it.
 */
export function RepublicationReview({ review, candidateVersionNumber }: {
  review: Review;
  candidateVersionNumber: number;
}) {
  const unchanged = !republicationChanged(review);
  const agentVersions = review.queued_versions.filter((version) => version.actor_kind === "mcp");

  return <section className="republication-review">
    <strong>
      What changes for the public: v{review.published_version_number} → v{candidateVersionNumber}
    </strong>
    {unchanged
      ? <p className="republication-unchanged">
        This version is identical to the one already public.
      </p>
      : <>
        {review.metadata_changes.map((change) => <div className="republication-metadata" key={change.field}>
          <span>{FIELD_LABELS[change.field]}</span>
          <del>{change.before ?? "—"}</del>
          <ins>{change.after}</ins>
        </div>)}
        {review.markdown_changes.map((change, index) => <div className="republication-hunk" key={index}>
          {change.before && <del>{change.before}</del>}
          {change.after && <ins>{change.after}</ins>}
        </div>)}
      </>}
    {review.queued_versions.length > 0 && <div className="republication-versions">
      <span>
        {review.queued_versions.length} {review.queued_versions.length === 1 ? "version" : "versions"} written
        since publication{agentVersions.length ? `, ${agentVersions.length} by an MCP client` : ""}
        {review.queued_versions_complete ? "" : " (older versions were pruned and are not listed)"}
      </span>
      {review.queued_versions.map((version) => <div
        className={version.actor_kind === "mcp" ? "republication-version agent" : "republication-version"}
        key={version.version_number}
      >
        <span>v{version.version_number}</span>
        <p>{version.commit_message}</p>
        <i>{versionAuthor(version)}</i>
      </div>)}
    </div>}
  </section>;
}

export function PublicationDialog({ page, versionNumber, publishedVersionNumber, onClose, onChanged }: {
  page: Page;
  versionNumber: number;
  publishedVersionNumber: number | undefined;
  onClose: () => void;
  onChanged: (action: "publish") => void | Promise<void>;
}) {
  const [preview, setPreview] = useState<PublicationPreview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setPreview(null);
    setConfirmed(false);
    setError("");
    api<PublicationPreview>(`/api/dashboard/pages/${page.id}/publication-preview?version=${versionNumber}`).then(setPreview).catch((cause: Error) => setError(cause.message));
  }, [page.id, versionNumber]);

  const targetIsLatest = page.version_number === versionNumber;
  const canPublish = Boolean(preview);

  const changeVisibility = async () => {
    if (!preview) return;
    setWorking(true);
    setError("");
    try {
      await confirmPublicationChange({
        action: "publish",
        targetKind: "page",
        targetId: page.id,
        versionId: preview.version_id,
      });
      await onChanged("publish");
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Publication change failed");
    } finally {
      setWorking(false);
    }
  };

  const title = page.published_version_id
    ? `Publish version v${versionNumber} instead`
    : `Publish version v${versionNumber}`;

  return <div className="modal-backdrop" role="presentation"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="publication-title">
    <button className="icon-button modal-close" onClick={onClose} aria-label="Close">×</button>
    <span className="eyebrow">Exact, immutable snapshot</span>
    <h2 id="publication-title">{title}</h2>
    {preview && <p className="publication-explanation">
      {page.published_version_id
        ? `This will replace public v${publishedVersionNumber ?? "?"} with v${preview.version_number}.`
        : `This will make v${preview.version_number} public.`}
      {!targetIsLatest && " Your latest editable version will not change."}
    </p>}
    <p className="public-url">Public URL: {location.origin}/p/{preview?.path ?? "…"}</p>
    {preview && <section className="publication-metadata"><strong>{preview.title}</strong><p>{preview.summary}</p></section>}
    {preview && <p className="publication-index-note">The framework will also expose the generated root and parent indexes needed to reach this page. Those indexes show folder titles, optional folder summaries, and explicitly published pages; private pages, instructions, and folder introductions remain hidden.</p>}
    {preview?.republication && <RepublicationReview
      review={preview.republication}
      candidateVersionNumber={preview.version_number}
    />}
    {preview?.warnings.map((warning) => <div className="warning" key={warning}>{warning}</div>)}
    {preview?.references.length ? <section className="reference-review"><strong>Linked content has independent visibility</strong>{preview.references.map((reference) => <div key={`${reference.kind}-${reference.id}`}><span>{reference.kind} · {reference.label}{reference.path ? ` · ${reference.path}` : ""}</span><i className={reference.public ? "visible" : "private"}>{reference.public ? "Public" : "Private / missing"}</i></div>)}</section> : null}
    <div className="publication-preview" dangerouslySetInnerHTML={{ __html: preview?.rendered_html ?? "Loading preview…" }} />
    {canPublish && <label className="check"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
      {preview?.republication && republicationChanged(preview.republication)
        ? `I reviewed everything that changed since public v${preview.republication.published_version_number} and understand that v${preview.version_number} will be public.`
        : `I reviewed v${preview?.version_number} and understand that this exact version will be public.`}
    </label>}
    {error && <p className="error">{error}</p>}
    <div className="button-row">
      {canPublish && <button className="primary" disabled={!confirmed || working || !preview} onClick={() => changeVisibility()}>{working ? "Waiting for passkey…" : `Publish v${versionNumber} with passkey`}</button>}
    </div>
  </section></div>;
}
