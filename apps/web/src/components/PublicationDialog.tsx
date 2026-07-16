import { startAuthentication } from "@simplewebauthn/browser";
import { useEffect, useState } from "react";
import { api } from "../api.ts";
import type { Page, PublicationPreview } from "../types.ts";

export function PublicationDialog({ page, onClose, onChanged }: {
  page: Page;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [preview, setPreview] = useState<PublicationPreview | null>(null);
  const [slug, setSlug] = useState(page.public_slug ?? page.current_path.split("/").at(-1)?.replaceAll("_", "-") ?? "page");
  const [confirmed, setConfirmed] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api<PublicationPreview>(`/api/dashboard/pages/${page.id}/publication-preview`).then(setPreview).catch((e: Error) => setError(e.message));
  }, [page.id]);

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
      onChanged();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Visibility change failed");
    } finally {
      setWorking(false);
    }
  };

  return <div className="modal-backdrop" role="presentation"><section className="modal" role="dialog" aria-modal="true">
    <button className="icon-button modal-close" onClick={onClose} aria-label="Close">×</button>
    <span className="eyebrow">Exact version {preview?.version_number ?? "…"}</span>
    <h2>{page.published_version_id ? "Change public visibility" : "Publish this page"}</h2>
    <label>Public slug<input value={slug} onChange={(event) => setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))} /></label>
    <p className="public-url">Public URL: {location.origin}/p/{slug || "…"}</p>
    {preview?.warnings.map((warning) => <div className="warning" key={warning}>{warning}</div>)}
    {preview?.references.length ? <section className="reference-review"><strong>Linked content has independent visibility</strong>{preview.references.map((reference) => <div key={`${reference.kind}-${reference.id}`}><span>{reference.kind} · {reference.label}{reference.path ? ` · ${reference.path}` : ""}</span><i className={reference.public ? "visible" : "private"}>{reference.public ? "Public" : "Private / missing"}</i></div>)}</section> : null}
    <div className="publication-preview" dangerouslySetInnerHTML={{ __html: preview?.rendered_html ?? "Loading preview…" }} />
    <label className="check"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />I reviewed this exact version and understand that public content can be copied.</label>
    {error && <p className="error">{error}</p>}
    <div className="button-row">
      {page.published_version_id && <button disabled={working} onClick={() => changeVisibility("unpublish")}>Unpublish with passkey</button>}
      <button className="primary" disabled={!confirmed || working || !preview} onClick={() => changeVisibility(page.published_version_id ? "republish" : "publish")}>{working ? "Waiting for passkey…" : "Confirm with passkey"}</button>
    </div>
  </section></div>;
}
