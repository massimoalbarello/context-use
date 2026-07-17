import { useState } from "react";
import { startAuthentication } from "@simplewebauthn/browser";
import { api } from "../api.ts";
import type { Asset } from "../types.ts";

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

  const visibility = async (action: "publish" | "unpublish") => {
    if (!window.confirm(action === "publish"
      ? `Publish the exact original bytes of ${asset.filename} (${asset.content_type}, ${(asset.size_bytes / 1024).toFixed(1)} KB)? Embedded EXIF, author, location, or document metadata may become public and is not removed.`
      : "Unpublish this asset? Existing third-party copies cannot be retracted.")) return;
    const created = await api<{ intent: { id: string }; authentication_options: Parameters<typeof startAuthentication>[0]["optionsJSON"] }>("/api/dashboard/publication-intents", {
      method: "POST",
      body: JSON.stringify({ action, target_kind: "asset", target_id: asset.id }),
    });
    const response = await startAuthentication({ optionsJSON: created.authentication_options });
    await api("/api/dashboard/publications/confirm", { method: "POST", body: JSON.stringify({ intent_id: created.intent.id, response }) });
    setMessage(action === "publish" ? "The asset is now public." : "The asset is now private.");
    await onChanged();
  };

  const remove = async () => {
    if (!window.confirm(`Permanently delete ${asset.filename}? Published assets must be unpublished first, and assets referenced by a public page are protected.`)) return;
    try {
      await api(`/api/dashboard/assets/${asset.id}`, { method: "DELETE" });
      await onDeleted();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Deletion failed"); }
  };

  return <main className="content-page asset-details"><header><div><span className="path">{asset.current_path}</span><h1>{asset.filename}</h1></div><span className={asset.published_at ? "status public" : "status"}>{asset.published_at ? "Public" : "Private"}</span></header>
    {message && <p>{message}</p>}
    <section className="asset-card"><div className="asset-icon">{asset.content_type.split("/")[0]}</div><dl><div><dt>Path</dt><dd>{asset.current_path}</dd></div><div><dt>Type</dt><dd>{asset.content_type}</dd></div><div><dt>Size</dt><dd>{(asset.size_bytes / 1024).toFixed(1)} KB</dd></div><div><dt>Uploaded</dt><dd>{new Date(asset.created_at).toLocaleString()}</dd></div></dl><code>context-use://asset/{asset.id}</code><div className="button-row"><a className="button" href={`/api/dashboard/assets/${asset.id}/content`} target="_blank" rel="noreferrer">Open</a><button onClick={() => visibility(asset.published_at ? "unpublish" : "publish")}>{asset.published_at ? "Unpublish" : "Publish with passkey"}</button>{!asset.published_at && <button className="danger" onClick={remove}>Delete</button>}</div></section>
  </main>;
}
