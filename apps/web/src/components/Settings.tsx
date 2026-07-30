import { startAuthentication } from "@simplewebauthn/browser";
import { useState } from "react";
import { api } from "../api.ts";
import { ActionDialog } from "./ActionDialog.tsx";
import { IntrinsicServices } from "./Services.tsx";

export type PasskeySummary = {
  id: string;
  name: string | null;
  created_at: string;
  device_type: string;
  backed_up: boolean;
};

type KnowledgeExportIntent = {
  intent: { id: string; expires_at: string };
  summary: { page_count: number; asset_count: number; total_bytes: number };
  authentication_options: Parameters<typeof startAuthentication>[0]["optionsJSON"];
};

type EnrollmentIntent = {
  intent: {
    id: string;
    name: string;
    authenticator_attachment: "cross-platform" | null;
    expires_at: string;
  };
  authentication_options: Parameters<typeof startAuthentication>[0]["optionsJSON"];
};

type EnrollmentAuthorization = {
  enrollment_claim: string;
  setup_url: string;
  expires_at: string;
  name: string;
  authenticator_attachment: "cross-platform" | null;
};

type RemovalIntent = {
  intent: {
    id: string;
    passkey_id: string;
    passkey_name: string | null;
    expires_at: string;
  };
  authentication_options: Parameters<typeof startAuthentication>[0]["optionsJSON"];
};

export function formatExportBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = units[0]!;
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index]!;
  }
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${unit}`;
}

export function Settings({
  passkeys,
  onPasskeysChanged,
}: {
  passkeys: PasskeySummary[];
  onPasskeysChanged: () => Promise<void>;
}) {
  const [message, setMessage] = useState("");
  const [passkeyName, setPasskeyName] = useState("");
  const [addMode, setAddMode] = useState<"hardware" | "device">("hardware");
  const [enrollmentIntent, setEnrollmentIntent] = useState<EnrollmentIntent | null>(null);
  const [enrollmentLink, setEnrollmentLink] = useState("");
  const [enrollmentPreparing, setEnrollmentPreparing] = useState(false);
  const [enrollmentWorking, setEnrollmentWorking] = useState(false);
  const [enrollmentError, setEnrollmentError] = useState("");
  const [removalIntent, setRemovalIntent] = useState<RemovalIntent | null>(null);
  const [removalPreparingId, setRemovalPreparingId] = useState("");
  const [removalWorking, setRemovalWorking] = useState(false);
  const [removalError, setRemovalError] = useState("");
  const [exportIntent, setExportIntent] = useState<KnowledgeExportIntent | null>(null);
  const [exportPreparing, setExportPreparing] = useState(false);
  const [exportWorking, setExportWorking] = useState(false);
  const [exportError, setExportError] = useState("");

  const prepareEnrollment = async () => {
    const name = passkeyName.trim();
    if (!name) {
      setEnrollmentError("Give this passkey a name first.");
      return;
    }
    setEnrollmentPreparing(true);
    setEnrollmentError("");
    setEnrollmentLink("");
    setMessage("");
    try {
      setEnrollmentIntent(await api<EnrollmentIntent>("/api/dashboard/passkey-enrollment-intents", {
        method: "POST",
        body: JSON.stringify({
          name,
          authenticator_attachment: addMode === "hardware" ? "cross-platform" : null,
        }),
      }));
    } catch (error) {
      setEnrollmentError(error instanceof Error ? error.message : "Could not prepare passkey enrollment");
    } finally {
      setEnrollmentPreparing(false);
    }
  };

  const authorizeEnrollment = async () => {
    if (!enrollmentIntent) return;
    setEnrollmentWorking(true);
    setEnrollmentError("");
    try {
      const response = await startAuthentication({ optionsJSON: enrollmentIntent.authentication_options });
      const authorization = await api<EnrollmentAuthorization>(
        `/api/dashboard/passkey-enrollment-intents/${encodeURIComponent(enrollmentIntent.intent.id)}/confirm`,
        {
          method: "POST",
          body: JSON.stringify({ response }),
        },
      );
      setEnrollmentIntent(null);
      if (authorization.authenticator_attachment === "cross-platform") {
        const { authClient } = await import("../auth-client.ts");
        const result = await authClient.passkey.addPasskey({
          name: authorization.name,
          authenticatorAttachment: "cross-platform",
          context: JSON.stringify({ enrollment_claim: authorization.enrollment_claim }),
        });
        if (result.error) throw new Error(result.error.message ?? "Hardware passkey setup failed");
        setPasskeyName("");
        setMessage(`${authorization.name} was added.`);
        await onPasskeysChanged();
      } else {
        setEnrollmentLink(authorization.setup_url);
        setMessage("Passkey enrollment authorized. Open the one-time link on the other device.");
      }
    } catch (error) {
      setEnrollmentError(error instanceof Error ? error.message : "Passkey enrollment failed");
    } finally {
      setEnrollmentWorking(false);
    }
  };

  const copyEnrollmentLink = async () => {
    try {
      await navigator.clipboard.writeText(enrollmentLink);
      setMessage("One-time passkey setup link copied.");
    } catch {
      setMessage("Could not copy automatically. Select and copy the link below.");
    }
  };

  const prepareRemoval = async (passkey: PasskeySummary) => {
    setRemovalPreparingId(passkey.id);
    setRemovalError("");
    setMessage("");
    try {
      setRemovalIntent(await api<RemovalIntent>(
        `/api/dashboard/passkeys/${encodeURIComponent(passkey.id)}/removal-intents`,
        { method: "POST", body: "{}" },
      ));
    } catch (error) {
      setRemovalError(error instanceof Error ? error.message : "Could not prepare passkey removal");
    } finally {
      setRemovalPreparingId("");
    }
  };

  const removePasskey = async () => {
    if (!removalIntent) return;
    setRemovalWorking(true);
    setRemovalError("");
    try {
      const response = await startAuthentication({ optionsJSON: removalIntent.authentication_options });
      await api(
        `/api/dashboard/passkeys/${encodeURIComponent(removalIntent.intent.passkey_id)}/remove`,
        {
          method: "POST",
          body: JSON.stringify({ intent_id: removalIntent.intent.id, response }),
        },
      );
      window.location.assign("/app");
    } catch (error) {
      setRemovalError(error instanceof Error ? error.message : "Passkey removal failed");
      setRemovalWorking(false);
    }
  };

  const prepareExport = async () => {
    setExportPreparing(true);
    setExportError("");
    setMessage("");
    try {
      setExportIntent(await api<KnowledgeExportIntent>("/api/dashboard/knowledge-export-intents", {
        method: "POST",
        body: "{}",
      }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not prepare the knowledge export");
    } finally {
      setExportPreparing(false);
    }
  };

  const downloadExport = async () => {
    if (!exportIntent) return;
    setExportWorking(true);
    setExportError("");
    try {
      const response = await startAuthentication({ optionsJSON: exportIntent.authentication_options });
      const confirmed = await api<{ download_url: string }>("/api/dashboard/knowledge-exports/confirm", {
        method: "POST",
        body: JSON.stringify({ intent_id: exportIntent.intent.id, response }),
      });
      setExportIntent(null);
      setMessage("Passkey verified. Your private knowledge export is downloading.");
      window.location.assign(confirmed.download_url);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Knowledge export failed");
    } finally {
      setExportWorking(false);
    }
  };
  return <main className="content-page settings-page"><header><div><span className="eyebrow">Owner-only controls</span><h1>Settings</h1></div></header>
    {message && <p>{message}</p>}
    <IntrinsicServices />
    <section><h2>Passkeys</h2><p>Passkeys sign in as the installation owner and can confirm sensitive actions. Adding or removing one requires fresh verification with an existing passkey, and at least one must always remain.</p>
      <div className="security-list">{passkeys.map((key) => <article key={key.id}><div><strong>{key.name || "Unnamed passkey"}</strong><span>Added {new Date(key.created_at).toLocaleString()} · {key.device_type === "singleDevice" ? "Device-bound passkey" : "Multi-device passkey"}{key.backed_up ? " · Backed up" : ""}</span></div><button className="danger" disabled={passkeys.length <= 1 || Boolean(removalPreparingId)} onClick={() => void prepareRemoval(key)}>{removalPreparingId === key.id ? "Preparing…" : "Remove"}</button></article>)}</div>
      {removalError && !removalIntent && <p className="error">{removalError}</p>}
      <div className="passkey-add">
        <label>Passkey name<input maxLength={80} placeholder="e.g. YubiKey 5C or Work laptop" value={passkeyName} onChange={(event) => setPasskeyName(event.target.value)} /></label>
        <div className="passkey-kind" role="group" aria-label="Passkey type">
          <label><input type="radio" name="passkey-kind" checked={addMode === "hardware"} onChange={() => setAddMode("hardware")} /><span><strong>Hardware security key</strong><small>Requests a USB, NFC, or other cross-platform authenticator instead of Touch ID.</small></span></label>
          <label><input type="radio" name="passkey-kind" checked={addMode === "device"} onChange={() => setAddMode("device")} /><span><strong>Another device</strong><small>Creates a five-minute, one-time setup link to open on that device.</small></span></label>
        </div>
        {enrollmentError && !enrollmentIntent && <p className="error">{enrollmentError}</p>}
        <button className="primary" disabled={enrollmentPreparing || enrollmentWorking} onClick={() => void prepareEnrollment()}>{enrollmentPreparing ? "Preparing…" : "Add passkey"}</button>
        {enrollmentLink && <div className="passkey-link"><strong>One-time setup link</strong><p>Open this on the device you are adding. It expires five minutes after authorization.</p><div><input readOnly value={enrollmentLink} onFocus={(event) => event.currentTarget.select()} /><button onClick={() => void copyEnrollmentLink()}>Copy</button></div></div>}
      </div>
    </section>
    <section><h2>Export knowledge</h2><p>Download the latest version of every active page and asset as a navigable Markdown vault. Private references become local links, and no publication or account metadata is included.</p><button className="primary" disabled={exportPreparing || exportWorking} onClick={() => void prepareExport()}>{exportPreparing ? "Checking assets…" : "Export with passkey"}</button></section>
    {enrollmentIntent && <ActionDialog
      eyebrow="Passkey enrollment"
      title={`Authorize ${enrollmentIntent.intent.name}?`}
      description={enrollmentIntent.intent.authenticator_attachment === "cross-platform"
        ? "First verify an existing passkey. Your browser will then ask for the new hardware security key; Touch ID is not requested for that registration."
        : "Verify an existing passkey to create a five-minute, single-use setup link for the other device."}
      confirmLabel="Verify and continue"
      workingLabel="Waiting for passkey…"
      working={enrollmentWorking}
      error={enrollmentError}
      onCancel={() => { setEnrollmentError(""); setEnrollmentIntent(null); }}
      onConfirm={() => void authorizeEnrollment()}
    />}
    {removalIntent && <ActionDialog
      eyebrow="Remove passkey"
      title={`Remove ${removalIntent.intent.passkey_name || "this passkey"}?`}
      description="A fresh passkey verification is required. Removing it revokes every dashboard session, including this one, and you will need to sign in again with a remaining passkey."
      confirmLabel="Verify and remove"
      workingLabel="Waiting for passkey…"
      working={removalWorking}
      error={removalError}
      onCancel={() => { setRemovalError(""); setRemovalIntent(null); }}
      onConfirm={() => void removePasskey()}
    />}
    {exportIntent && <ActionDialog
      eyebrow="Private knowledge export"
      title="Download your knowledge base?"
      description="The ZIP contains all private and public knowledge that is current when the download starts. It will be unencrypted on this computer. A fresh owner-passkey verification is required, and this authorization can be used only once from this dashboard session."
      confirmLabel="Verify passkey and download"
      workingLabel="Waiting for passkey…"
      working={exportWorking}
      error={exportError}
      onCancel={() => { setExportError(""); setExportIntent(null); }}
      onConfirm={() => void downloadExport()}
    >
      <dl className="action-dialog-details">
        <div><dt>Current pages</dt><dd>about {exportIntent.summary.page_count}</dd></div>
        <div><dt>Current assets</dt><dd>about {exportIntent.summary.asset_count}</dd></div>
        <div><dt>Current size</dt><dd>about {formatExportBytes(exportIntent.summary.total_bytes)}</dd></div>
      </dl>
    </ActionDialog>}
  </main>;
}
