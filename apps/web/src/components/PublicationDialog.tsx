import { startAuthentication } from "@simplewebauthn/browser";
import { useEffect, useState } from "react";
import { api } from "../api.ts";
import type { Page, PublicationPreview } from "../types.ts";

export function PublicationDialog({ page, versionNumber, publishedVersionNumber, onClose, onChanged }: {
  page: Page;
  versionNumber: number;
  publishedVersionNumber: number | undefined;
  onClose: () => void;
  onChanged: (action: "publish" | "republish" | "unpublish") => void | Promise<void>;
}) {
  const [preview, setPreview] = useState<PublicationPreview | null>(null);
  const [slug, setSlug] = useState(page.public_slug ?? page.current_path.split("/").at(-1)?.replaceAll("_", "-") ?? "page");
  const [confirmed, setConfirmed] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setPreview(null);
    setConfirmed(false);
    setError("");
    api<PublicationPreview>(`/api/dashboard/pages/${page.id}/publication-preview?version=${versionNumber}`).then(setPreview).catch((cause: Error) => setError(cause.message));
  }, [page.id, versionNumber]);

  const targetIsPublished = Boolean(page.published_version_id && publishedVersionNumber === versionNumber);
  const targetIsLatest = page.version_number === versionNumber;
  const slugChanged = slug !== page.public_slug;
  const canPublish = Boolean(preview && (!targetIsPublished || slugChanged));

  const changeVisibility = async (action: "publish" | "republish" | "unpublish") => {
    if (!preview) return;
    setWorking(true);
    setError("");
    try {
      const created = await api<{
        intent: { id: string };
        authentication_options: Parameters<typeof startAuthentication>[0]["optionsJSON"];
      }>("/api/dashboard/publication-intents", {
        method: "POST",
        body: JSON.stringify({
          action,
          target_kind: "page",
          target_id: page.id,
          version_id: action === "unpublish" ? null : preview.version_id,
          public_slug: action === "unpublish" ? null : slug,
        }),
      });
      const response = await startAuthentication({ optionsJSON: created.authentication_options });
      await api("/api/dashboard/publications/confirm", {
        method: "POST",
        body: JSON.stringify({ intent_id: created.intent.id, response }),
      });
      await onChanged(action);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Publication change failed");
    } finally {
      setWorking(false);
    }
  };

  const title = targetIsPublished
    ? `Manage published version v${versionNumber}`
    : page.published_version_id
      ? `Publish version v${versionNumber} instead`
      : `Publish version v${versionNumber}`;

  return <div className="modal-backdrop" role="presentation"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="publication-title">
    <button className="icon-button modal-close" onClick={onClose} aria-label="Close">×</button>
    <span className="eyebrow">Exact, immutable snapshot</span>
    <h2 id="publication-title">{title}</h2>
    {preview && <p className="publication-explanation">
      {targetIsPublished
        ? "This exact version is public. You can change its URL or unpublish it."
        : page.published_version_id
          ? `This will replace public v${publishedVersionNumber ?? "?"} with v${preview.version_number}.`
          : `This will make v${preview.version_number} public.`}
      {!targetIsLatest && " Your latest editable version will not change."}
    </p>}
    <label>Public slug<input value={slug} onChange={(event) => setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))} /></label>
    <p className="public-url">Public URL: {location.origin}/p/{slug || "…"}</p>
    {preview?.warnings.map((warning) => <div className="warning" key={warning}>{warning}</div>)}
    {preview?.references.length ? <section className="reference-review"><strong>Linked content has independent visibility</strong>{preview.references.map((reference) => <div key={`${reference.kind}-${reference.id}`}><span>{reference.kind} · {reference.label}{reference.path ? ` · ${reference.path}` : ""}</span><i className={reference.public ? "visible" : "private"}>{reference.public ? "Public" : "Private / missing"}</i></div>)}</section> : null}
    <div className="publication-preview" dangerouslySetInnerHTML={{ __html: preview?.rendered_html ?? "Loading preview…" }} />
    {canPublish && <label className="check"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />I reviewed v{preview?.version_number} and understand that this exact version will be public.</label>}
    {targetIsPublished && !slugChanged && <div className="publication-current">v{versionNumber} is already the version at this public URL.</div>}
    {error && <p className="error">{error}</p>}
    <div className="button-row">
      {targetIsPublished && <button className="danger" disabled={working} onClick={() => changeVisibility("unpublish")}>Unpublish with passkey</button>}
      {canPublish && <button className="primary" disabled={!confirmed || working || !preview || !slug} onClick={() => changeVisibility(page.published_version_id ? "republish" : "publish")}>{working ? "Waiting for passkey…" : `Publish v${versionNumber} with passkey`}</button>}
    </div>
  </section></div>;
}
