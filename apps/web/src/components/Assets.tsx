import { useEffect, useState } from "react";
import { startAuthentication } from "@simplewebauthn/browser";
import { api, uploadAssetContent } from "../api.ts";
import type { Asset, AssetStatus } from "../types.ts";

type ContentState = "checking" | "available" | "missing";
type PreviewKind = "image" | "video" | "pdf" | null;

export function assetPreviewKind(contentType: string): PreviewKind {
  const normalized = contentType.toLowerCase();
  if (/^image\/(?:png|jpeg|gif|webp|avif)$/.test(normalized)) return "image";
  if (/^video\/(?:mp4|webm|quicktime)$/.test(normalized)) return "video";
  if (normalized === "application/pdf") return "pdf";
  return null;
}

function AssetPreview({ asset, onPreviewError }: { asset: Asset; onPreviewError: () => void }) {
  const url = `/api/dashboard/assets/${asset.id}/content`;
  const kind = assetPreviewKind(asset.content_type);
  if (kind === "image") return <div className="asset-preview"><img src={url} alt={`Preview of ${asset.filename}`} onError={onPreviewError} /></div>;
  if (kind === "video") return <div className="asset-preview"><video src={url} controls preload="metadata" onError={onPreviewError}>Your browser cannot preview this video.</video></div>;
  if (kind === "pdf") return <div className="asset-preview pdf"><iframe src={`${url}#toolbar=0&navpanes=0`} title={`Preview of ${asset.filename}`} /></div>;
  return <div className="asset-icon"><span>{asset.content_type.split("/")[0]}</span><small>Preview unavailable for this format</small></div>;
}

export function AssetDetails({
  asset,
  onChanged,
  onDeleted,
}: {
  asset: Asset;
  onChanged: () => Promise<void> | void;
  onDeleted: () => Promise<void> | void;
}) {
  const [message, setMessage] = useState("");
  const [contentState, setContentState] = useState<ContentState>("checking");
  const [publicUrl, setPublicUrl] = useState("");
  const [busy, setBusy] = useState<"publish" | "unpublish" | "upload" | "delete" | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);

  const refreshStatus = async () => {
    const status = await api<AssetStatus>(`/api/dashboard/assets/${asset.id}/status`);
    setContentState(status.content_available ? "available" : "missing");
    setPublicUrl(status.public_url);
    setPreviewFailed(false);
  };

  useEffect(() => {
    setContentState("checking");
    refreshStatus().catch((error: unknown) => {
      setContentState("missing");
      setMessage(error instanceof Error ? error.message : "Could not check asset content");
    });
  }, [asset.id]);

  const visibility = async (action: "publish" | "unpublish") => {
    if (!window.confirm(action === "publish"
      ? `Publish the exact original bytes of ${asset.filename} (${asset.content_type}, ${(asset.size_bytes / 1024).toFixed(1)} KB)? Embedded EXIF, author, location, or document metadata may become public and is not removed.`
      : "Unpublish this asset? Existing third-party copies cannot be retracted.")) return;
    setBusy(action);
    setMessage("");
    try {
      const created = await api<{ intent: { id: string }; authentication_options: Parameters<typeof startAuthentication>[0]["optionsJSON"] }>("/api/dashboard/publication-intents", {
        method: "POST",
        body: JSON.stringify({ action, target_kind: "asset", target_id: asset.id }),
      });
      const response = await startAuthentication({ optionsJSON: created.authentication_options });
      await api("/api/dashboard/publications/confirm", { method: "POST", body: JSON.stringify({ intent_id: created.intent.id, response }) });
      setMessage(action === "publish" ? "Published. The public URL below is now live." : "The asset is now private.");
      await onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Publication failed");
    } finally {
      setBusy(null);
    }
  };

  const finishUpload = async (file: File) => {
    const expectedSize = Number(asset.size_bytes);
    if (file.size !== expectedSize) {
      setMessage(`That file is ${file.size} bytes; the original asset must be exactly ${expectedSize} bytes.`);
      return;
    }
    setBusy("upload");
    setMessage("");
    try {
      await uploadAssetContent(asset.id, file, asset.content_type);
      await refreshStatus();
      setMessage("Upload complete. The preview and publication controls are ready.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setBusy(null);
    }
  };

  const copyPublicUrl = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setMessage("Public URL copied.");
    } catch {
      setMessage("Could not copy the public URL. You can select it below instead.");
    }
  };

  const remove = async () => {
    if (!window.confirm(`Permanently delete ${asset.filename}? Published assets must be unpublished first, and assets referenced by a public page are protected.`)) return;
    setBusy("delete");
    try {
      await api(`/api/dashboard/assets/${asset.id}`, { method: "DELETE" });
      await onDeleted();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Deletion failed");
      setBusy(null);
    }
  };

  return <main className="content-page asset-details"><header><div><span className="path">{asset.current_path}</span><h1>{asset.filename}</h1></div><span className={asset.published_at ? "status public" : "status"}>{asset.published_at ? "Public" : "Private"}</span></header>
    {message && <p className="asset-message" role="status">{message}</p>}
    <section className="asset-card">
      {contentState === "checking" && <div className="asset-preview-state">Checking asset content…</div>}
      {contentState === "missing" && <div className="asset-preview-state error"><strong>Content upload incomplete</strong><span>The asset record exists, but its original bytes are missing or do not match. Choose the exact original file to finish the upload.</span><label className="button asset-upload-button">{busy === "upload" ? "Uploading…" : "Choose original file"}<input type="file" accept={asset.content_type} disabled={busy !== null} onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void finishUpload(file); }} /></label></div>}
      {contentState === "available" && !previewFailed && <AssetPreview asset={asset} onPreviewError={() => setPreviewFailed(true)} />}
      {contentState === "available" && previewFailed && <div className="asset-preview-state"><strong>Preview unavailable</strong><span>The content is stored correctly, but this browser could not display the format. You can still open the original file.</span></div>}
      <dl><div><dt>Path</dt><dd>{asset.current_path}</dd></div><div><dt>Type</dt><dd>{asset.content_type}</dd></div><div><dt>Size</dt><dd>{(asset.size_bytes / 1024).toFixed(1)} KB</dd></div><div><dt>{contentState === "available" ? "Uploaded" : "Record created"}</dt><dd>{new Date(asset.created_at).toLocaleString()}</dd></div></dl>
      <div className="asset-reference"><span>Private reference</span><code>context-use://asset/{asset.id}</code></div>
      {asset.published_at && publicUrl && <div className="asset-reference public"><span>Public URL</span><div><code>{publicUrl}</code><button onClick={copyPublicUrl}>Copy</button></div></div>}
      <div className="button-row">
        {contentState === "available" && <a className="button" href={`/api/dashboard/assets/${asset.id}/content`} target="_blank" rel="noreferrer">Open original</a>}
        {asset.published_at && publicUrl && <a className="button primary" href={publicUrl} target="_blank" rel="noreferrer">Open public link</a>}
        <button disabled={busy !== null || (!asset.published_at && contentState !== "available")} title={!asset.published_at && contentState === "missing" ? "Finish the content upload before publishing" : undefined} onClick={() => visibility(asset.published_at ? "unpublish" : "publish")}>{busy === "publish" ? "Publishing…" : busy === "unpublish" ? "Unpublishing…" : asset.published_at ? "Unpublish" : "Publish with passkey"}</button>
        {!asset.published_at && <button className="danger" disabled={busy !== null} onClick={remove}>{busy === "delete" ? "Deleting…" : "Delete"}</button>}
      </div>
    </section>
  </main>;
}
