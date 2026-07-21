import { useEffect, useState } from "react";
import { api } from "../api.ts";
import { confirmPublicationChange } from "../publication-auth.ts";
import type { Page, PublicationPreview } from "../types.ts";

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
    {preview && <p className="publication-index-note">The framework will also expose the generated root and parent indexes needed to reach this page. Those indexes contain only explicitly published page titles and summaries; private pages and private directory metadata remain hidden.</p>}
    {preview?.warnings.map((warning) => <div className="warning" key={warning}>{warning}</div>)}
    {preview?.references.length ? <section className="reference-review"><strong>Linked content has independent visibility</strong>{preview.references.map((reference) => <div key={`${reference.kind}-${reference.id}`}><span>{reference.kind} · {reference.label}{reference.path ? ` · ${reference.path}` : ""}</span><i className={reference.public ? "visible" : "private"}>{reference.public ? "Public" : "Private / missing"}</i></div>)}</section> : null}
    <div className="publication-preview" dangerouslySetInnerHTML={{ __html: preview?.rendered_html ?? "Loading preview…" }} />
    {canPublish && <label className="check"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />I reviewed v{preview?.version_number} and understand that this exact version will be public.</label>}
    {error && <p className="error">{error}</p>}
    <div className="button-row">
      {canPublish && <button className="primary" disabled={!confirmed || working || !preview} onClick={() => changeVisibility()}>{working ? "Waiting for passkey…" : `Publish v${versionNumber} with passkey`}</button>}
    </div>
  </section></div>;
}
