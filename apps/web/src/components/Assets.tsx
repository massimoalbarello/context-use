import { useEffect, useState } from "react";
import { startAuthentication } from "@simplewebauthn/browser";
import { api, uploadFile } from "../api.ts";
import type { Asset } from "../types.ts";
import "./Assets.css";

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function assetTypeLabel(asset: Asset): string {
  const extension = asset.filename.match(/\.([a-z0-9]{1,8})$/i)?.[1];
  return extension?.toUpperCase() ?? asset.content_type.split("/")[0] ?? "file";
}

function AssetPreview({ asset }: { asset: Asset }) {
  const [failed, setFailed] = useState(false);
  const source = `/api/dashboard/assets/${asset.id}/preview`;

  if (!failed && /^(image\/(?:png|jpeg|gif|webp))$/i.test(asset.content_type)) {
    return <div className="asset-preview"><img src={source} alt={`Preview of ${asset.filename}`} loading="lazy" onError={() => setFailed(true)} /></div>;
  }
  if (!failed && /^application\/pdf$/i.test(asset.content_type)) {
    return <div className="asset-preview pdf-preview"><iframe src={`${source}#page=1&view=FitH&toolbar=0&navpanes=0&scrollbar=0`} title={`Preview of ${asset.filename}`} loading="lazy" tabIndex={-1} /></div>;
  }
  return <div className="asset-icon">{assetTypeLabel(asset)}</div>;
}

export function Assets() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [message, setMessage] = useState("");
  const load = () => api<Asset[]>("/api/dashboard/assets").then(setAssets);
  useEffect(() => { load().catch((error: Error) => setMessage(error.message)); }, []);

  const upload = async (file: File) => {
    setMessage("Hashing and preparing upload…");
    try {
      const created = await api<{ asset: Asset }>("/api/dashboard/assets/upload-intent", {
        method: "POST",
        body: JSON.stringify({ filename: file.name, content_type: file.type || "application/octet-stream", size_bytes: file.size, sha256: await sha256(file) }),
      });
      await uploadFile(`/api/dashboard/assets/${created.asset.id}/content`, file, created.asset.content_type);
      setMessage("Asset uploaded privately.");
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Upload failed"); }
  };

  const visibility = async (asset: Asset, action: "publish" | "unpublish") => {
    if (!window.confirm(action === "publish"
      ? `Publish the exact original bytes of ${asset.filename} (${asset.content_type}, ${(asset.size_bytes / 1024).toFixed(1)} KB)? Embedded EXIF, author, location, or document metadata may become public and is not removed.`
      : "Unpublish this asset? Existing third-party copies cannot be retracted.")) return;
    const created = await api<{ intent: { id: string }; authentication_options: Parameters<typeof startAuthentication>[0]["optionsJSON"] }>("/api/dashboard/publication-intents", {
      method: "POST",
      body: JSON.stringify({ action, target_kind: "asset", target_id: asset.id }),
    });
    const response = await startAuthentication({ optionsJSON: created.authentication_options });
    await api("/api/dashboard/publications/confirm", { method: "POST", body: JSON.stringify({ intent_id: created.intent.id, response }) });
    await load();
  };

  const remove = async (asset: Asset) => {
    if (!window.confirm(`Permanently delete ${asset.filename}? Published assets must be unpublished first, and assets referenced by a public page are protected.`)) return;
    try {
      await api(`/api/dashboard/assets/${asset.id}`, { method: "DELETE" });
      setMessage("Asset deleted. S3 versioning retains a recoverable noncurrent copy for the configured safety period.");
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Deletion failed"); }
  };

  return <main className="content-page"><header><div><span className="eyebrow">Private by default</span><h1>Assets</h1></div><label className="upload-button">Upload asset<input type="file" onChange={(event) => event.target.files?.[0] && upload(event.target.files[0])} /></label></header>
    {message && <p>{message}</p>}
    <div className="asset-grid">{assets.map((asset) => <article key={asset.id}><AssetPreview asset={asset} /><strong className="asset-name" title={asset.filename}>{asset.filename}</strong><span>{(asset.size_bytes / 1024).toFixed(1)} KB · {asset.published_at ? "Public" : "Private"}</span><code>context-use://asset/{asset.id}</code><div className="button-row"><a className="button" href={`/api/dashboard/assets/${asset.id}/content`} target="_blank" rel="noreferrer">Open</a><button onClick={() => visibility(asset, asset.published_at ? "unpublish" : "publish")}>{asset.published_at ? "Unpublish" : "Publish with passkey"}</button>{!asset.published_at && <button className="danger" onClick={() => remove(asset)}>Delete</button>}</div></article>)}</div>
  </main>;
}
