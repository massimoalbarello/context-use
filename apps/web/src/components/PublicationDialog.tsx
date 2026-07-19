import { useEffect, useState } from "react";
import { api } from "../api.ts";
import { confirmPublicationChange } from "../publication-auth.ts";
import type { Page, PublicationPreview } from "../types.ts";

export function PublicationDialog({ page, versionNumber, publishedVersionNumber, onClose, onChanged }: {
  page: Page;
  versionNumber: number;
  publishedVersionNumber: number | undefined;
  onClose: () => void;
  onChanged: (action: "publish" | "republish") => void | Promise<void>;
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
  const requiredPath = page.required_public_path;
  const canPublish = Boolean(preview);

  const changeVisibility = async (action: "publish" | "republish") => {
    if (!preview) return;
    setWorking(true);
    setError("");
    try {
      await confirmPublicationChange({
        action,
        targetKind: "page",
        targetId: page.id,
        versionId: preview.version_id,
      });
      await onChanged(action);
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
      {requiredPath
        ? `This is the required personal landing page at /p/${requiredPath}. You can publish another version, but it cannot be moved or unpublished.`
        : page.published_version_id
          ? `This will replace public v${publishedVersionNumber ?? "?"} with v${preview.version_number}.`
          : `This will make v${preview.version_number} public.`}
      {!targetIsLatest && " Your latest editable version will not change."}
    </p>}
    <p className="public-url">Public URL: {location.origin}/p/{preview?.path ?? "…"}</p>
    {preview?.warnings.map((warning) => <div className="warning" key={warning}>{warning}</div>)}
    {preview?.references.length ? <section className="reference-review"><strong>Linked content has independent visibility</strong>{preview.references.map((reference) => <div key={`${reference.kind}-${reference.id}`}><span>{reference.kind} · {reference.label}{reference.path ? ` · ${reference.path}` : ""}</span><i className={reference.public ? "visible" : "private"}>{reference.public ? "Public" : "Private / missing"}</i></div>)}</section> : null}
    <div className="publication-preview" dangerouslySetInnerHTML={{ __html: preview?.rendered_html ?? "Loading preview…" }} />
    {canPublish && <label className="check"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />I reviewed v{preview?.version_number} and understand that this exact version will be public.</label>}
    {error && <p className="error">{error}</p>}
    <div className="button-row">
      {canPublish && <button className="primary" disabled={!confirmed || working || !preview} onClick={() => changeVisibility(page.published_version_id ? "republish" : "publish")}>{working ? "Waiting for passkey…" : `Publish v${versionNumber} with passkey`}</button>}
    </div>
  </section></div>;
}
