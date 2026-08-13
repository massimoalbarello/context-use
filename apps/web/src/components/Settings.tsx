import { startAuthentication } from "@simplewebauthn/browser";
import { useEffect, useState } from "react";
import { ApiError, api, uploadKnowledgeArchive } from "../api.ts";
import { ActionDialog } from "./ActionDialog.tsx";
import { KnowledgeTemplateSettings } from "./KnowledgeTemplate.tsx";
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
  summary: { kind: "portable" | "restorable"; page_count: number; asset_count: number; total_bytes: number };
  authentication_options: Parameters<typeof startAuthentication>[0]["optionsJSON"];
};

type KnowledgeExportConfirmation = {
  prepare_url: string;
  status_url: string;
  download_url: string;
};

type KnowledgeExportStatus =
  | { status: "processing"; status_url: string }
  | { status: "ready"; download_url: string; filename: string; size_bytes: number }
  | { status: "failed"; message: string; code: string; retry_url: string };

export type KnowledgeExportJob = {
  intentId: string;
  kind: "portable" | "restorable";
  status: "processing" | "ready" | "failed";
  prepareUrl: string;
  statusUrl: string;
  downloadUrl: string;
  filename?: string | undefined;
  sizeBytes?: number | undefined;
  error?: string | undefined;
  checkError?: string | undefined;
};

const exportJobStorageKey = "context-use.knowledge-export-job";

function storedExportJob(): KnowledgeExportJob | null {
  if (typeof window === "undefined") return null;
  try {
    const value = JSON.parse(window.sessionStorage.getItem(exportJobStorageKey) ?? "null") as Partial<KnowledgeExportJob> | null;
    if (!value || typeof value.intentId !== "string" || !/^[a-f0-9-]{36}$/.test(value.intentId)
        || (value.kind !== "portable" && value.kind !== "restorable")) return null;
    const root = `/api/dashboard/knowledge-exports/${encodeURIComponent(value.intentId)}`;
    return {
      intentId: value.intentId,
      kind: value.kind,
      status: "processing",
      prepareUrl: `${root}/prepare`,
      statusUrl: `${root}/status`,
      downloadUrl: `${root}/download`,
    };
  } catch {
    return null;
  }
}

type KnowledgeImportIntent = {
  intent: { id: string; expires_at: string };
  summary: {
    directories: number;
    pages: number;
    page_versions: number;
    assets: number;
    active_assets: number;
    asset_links: number;
    page_changes: number;
    active_asset_bytes: number;
    created_at: string;
  };
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

export function KnowledgeExportPreparationStatus({
  job,
  onDownload,
  onRetry,
  onReset,
}: {
  job: KnowledgeExportJob;
  onDownload: () => void;
  onRetry: () => void;
  onReset: () => void;
}) {
  return <div className={`export-preparation ${job.status}`} role="status" aria-live="polite">
    <div className="export-preparation-copy">
      {job.status === "processing" && <span className="export-spinner" aria-hidden="true" />}
      <div>
        <strong>{job.status === "processing"
          ? `Preparing ${job.kind === "restorable" ? "full archive" : "latest snapshot"}…`
          : job.status === "ready"
            ? "Archive ready to download"
            : "Archive preparation stopped"}</strong>
        {job.status === "processing" && <small>The ZIP is being assembled and checked. You can leave Settings; progress will resume when you return.</small>}
        {job.status === "ready" && <small>{job.filename}{job.sizeBytes ? ` · ${formatExportBytes(job.sizeBytes)}` : ""}</small>}
        {job.status === "failed" && <small className="error">{job.error || job.checkError || "The archive could not be prepared."}</small>}
        {job.status === "processing" && job.checkError && <small className="error">Progress check delayed: {job.checkError}. Retrying automatically…</small>}
      </div>
    </div>
    {job.status === "ready" && <div className="export-preparation-actions">
      <a className="button primary" href={job.downloadUrl} onClick={onDownload}>Download archive</a>
      <button onClick={onReset}>Prepare another</button>
    </div>}
    {job.status === "failed" && <div className="export-preparation-actions">
      <button className="primary" onClick={onRetry}>Retry preparation</button>
      <button onClick={onReset}>Start over</button>
    </div>}
  </div>;
}

export function Settings({
  passkeys,
  onPasskeysChanged,
  onKnowledgeChanged,
}: {
  passkeys: PasskeySummary[];
  onPasskeysChanged: () => Promise<void>;
  onKnowledgeChanged: () => Promise<void>;
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
  const [exportKind, setExportKind] = useState<"portable" | "restorable">("portable");
  const [exportPreparing, setExportPreparing] = useState(false);
  const [exportWorking, setExportWorking] = useState(false);
  const [exportError, setExportError] = useState("");
  const [exportJob, setExportJob] = useState<KnowledgeExportJob | null>(storedExportJob);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importIntent, setImportIntent] = useState<KnowledgeImportIntent | null>(null);
  const [importPreparing, setImportPreparing] = useState(false);
  const [importWorking, setImportWorking] = useState(false);
  const [importError, setImportError] = useState("");
  const [importEligible, setImportEligible] = useState<boolean | null>(null);
  const [importEligibilityError, setImportEligibilityError] = useState("");

  useEffect(() => {
    let active = true;
    api<{ eligible: boolean }>("/api/dashboard/knowledge-import-eligibility")
      .then(({ eligible }) => { if (active) setImportEligible(eligible); })
      .catch(() => { if (active) setImportEligibilityError("Import availability could not be checked. Reload Settings to try again."); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (exportJob) {
      window.sessionStorage.setItem(exportJobStorageKey, JSON.stringify({
        intentId: exportJob.intentId,
        kind: exportJob.kind,
      }));
    } else {
      window.sessionStorage.removeItem(exportJobStorageKey);
    }
  }, [exportJob?.intentId, exportJob?.kind]);

  useEffect(() => {
    if (!exportJob || exportJob.status !== "processing") return;
    let active = true;
    let timeout: number | undefined;
    const poll = async () => {
      try {
        const status = await api<KnowledgeExportStatus>(exportJob.statusUrl);
        if (!active) return;
        if (status.status === "ready") {
          setExportJob((current) => current && current.intentId === exportJob.intentId ? {
            ...current,
            status: "ready",
            downloadUrl: status.download_url,
            filename: status.filename,
            sizeBytes: status.size_bytes,
            error: undefined,
            checkError: undefined,
          } : current);
          return;
        }
        if (status.status === "failed") {
          setExportJob((current) => current && current.intentId === exportJob.intentId ? {
            ...current,
            status: "failed",
            prepareUrl: status.retry_url,
            error: status.message,
            checkError: undefined,
          } : current);
          return;
        }
        setExportJob((current) => current && current.intentId === exportJob.intentId
          ? { ...current, checkError: undefined }
          : current);
      } catch (error) {
        if (!active) return;
        setExportJob((current) => current && current.intentId === exportJob.intentId ? {
          ...current,
          ...(error instanceof ApiError && (error.status === 403 || error.status === 404)
            ? { status: "failed" as const, error: error.message }
            : {}),
          checkError: error instanceof Error ? error.message : "Could not check archive progress",
        } : current);
      }
      if (active) timeout = window.setTimeout(() => void poll(), 2_000);
    };
    void poll();
    return () => {
      active = false;
      if (timeout !== undefined) window.clearTimeout(timeout);
    };
  }, [exportJob?.intentId, exportJob?.status, exportJob?.statusUrl]);

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
        body: JSON.stringify({ kind: exportKind }),
      }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not prepare the knowledge export");
    } finally {
      setExportPreparing(false);
    }
  };

  const prepareImport = async () => {
    if (!importFile) {
      setImportError("Choose a full Context Use archive first.");
      return;
    }
    setImportPreparing(true);
    setImportError("");
    setMessage("");
    try {
      setImportIntent(await uploadKnowledgeArchive<KnowledgeImportIntent>(importFile));
    } catch (error) {
      if (error instanceof ApiError && error.code === "import_requires_fresh_instance") {
        setImportFile(null);
        setImportEligible(false);
        return;
      }
      setImportError(error instanceof Error ? error.message : "Could not validate the knowledge archive");
    } finally {
      setImportPreparing(false);
    }
  };

  const restoreImport = async () => {
    if (!importIntent) return;
    setImportWorking(true);
    setImportError("");
    try {
      const response = await startAuthentication({ optionsJSON: importIntent.authentication_options });
      const confirmed = await api<{ restore_url: string }>("/api/dashboard/knowledge-imports/confirm", {
        method: "POST",
        body: JSON.stringify({ intent_id: importIntent.intent.id, response }),
      });
      await api(confirmed.restore_url, { method: "POST", body: "{}" });
      setImportIntent(null);
      setImportFile(null);
      setMessage("The full knowledge archive was restored with its original IDs, history, links, assets, and publication state.");
      window.location.assign("/app");
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Knowledge import failed");
    } finally {
      setImportWorking(false);
    }
  };

  const cancelImport = async () => {
    if (!importIntent || importWorking) return;
    const intent = importIntent;
    setImportIntent(null);
    setImportError("");
    await api(`/api/dashboard/knowledge-import-intents/${encodeURIComponent(intent.intent.id)}`, {
      method: "DELETE",
      body: "{}",
    }).catch(() => undefined);
  };

  const downloadExport = async () => {
    if (!exportIntent) return;
    setExportWorking(true);
    setExportError("");
    try {
      const response = await startAuthentication({ optionsJSON: exportIntent.authentication_options });
      const confirmed = await api<KnowledgeExportConfirmation>("/api/dashboard/knowledge-exports/confirm", {
        method: "POST",
        body: JSON.stringify({ intent_id: exportIntent.intent.id, response }),
      });
      const intentId = exportIntent.intent.id;
      const kind = exportIntent.summary.kind;
      setExportIntent(null);
      setMessage("");
      setExportJob({
        intentId,
        kind,
        status: "processing",
        prepareUrl: confirmed.prepare_url,
        statusUrl: confirmed.status_url,
        downloadUrl: confirmed.download_url,
      });
      try {
        const preparation = await api<KnowledgeExportStatus>(confirmed.prepare_url, { method: "POST", body: "{}" });
        if (preparation.status === "ready") {
          setExportJob((current) => current && current.intentId === intentId ? {
            ...current,
            status: "ready",
            downloadUrl: preparation.download_url,
            filename: preparation.filename,
            sizeBytes: preparation.size_bytes,
          } : current);
        } else if (preparation.status === "failed") {
          setExportJob((current) => current && current.intentId === intentId ? {
            ...current,
            status: "failed",
            prepareUrl: preparation.retry_url,
            error: preparation.message,
          } : current);
        }
      } catch (error) {
        // The status poll remains authoritative if this request loses its
        // response after the server has already started preparation.
        setExportJob((current) => current && current.intentId === intentId ? {
          ...current,
          checkError: error instanceof Error ? error.message : "Could not start archive preparation",
        } : current);
      }
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Knowledge export failed");
    } finally {
      setExportWorking(false);
    }
  };

  const retryExport = async () => {
    if (!exportJob || exportJob.status === "processing") return;
    const intentId = exportJob.intentId;
    setExportJob({ ...exportJob, status: "processing", error: undefined, checkError: undefined });
    try {
      const preparation = await api<KnowledgeExportStatus>(exportJob.prepareUrl, { method: "POST", body: "{}" });
      if (preparation.status === "ready") {
        setExportJob((current) => current && current.intentId === intentId ? {
          ...current,
          status: "ready",
          downloadUrl: preparation.download_url,
          filename: preparation.filename,
          sizeBytes: preparation.size_bytes,
        } : current);
      }
    } catch (error) {
      setExportJob((current) => current && current.intentId === intentId ? {
        ...current,
        ...(error instanceof ApiError && (error.status === 403 || error.status === 404)
          ? { status: "failed" as const, error: error.message }
          : {}),
        checkError: error instanceof Error ? error.message : "Could not restart archive preparation",
      } : current);
    }
  };
  return <main className="content-page settings-page"><header><div><span className="eyebrow">Owner-only controls</span><h1>Settings</h1></div></header>
    {message && <p>{message}</p>}
    <IntrinsicServices />
    <KnowledgeTemplateSettings onKnowledgeChanged={onKnowledgeChanged} />
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
    <section><h2>Export knowledge</h2>
      <p>The default export is a readable Markdown vault. Choose the full archive only for moving or restoring a Context Use instance.</p>
      <div className="passkey-kind" role="group" aria-label="Knowledge export type">
        <label><input type="radio" name="export-kind" disabled={Boolean(exportJob)} checked={exportKind === "portable"} onChange={() => setExportKind("portable")} /><span><strong>Latest snapshot</strong><small>Current active pages and assets, rewritten as a navigable Markdown vault.</small></span></label>
        <label><input type="radio" name="export-kind" disabled={Boolean(exportJob)} checked={exportKind === "restorable"} onChange={() => setExportKind("restorable")} /><span><strong>Full restorable archive</strong><small>Stable IDs, all retained versions, archived pages, publication state, link records, history, and active asset bytes.</small></span></label>
      </div>
      {!exportJob && <button className="primary export-start-button" disabled={exportPreparing || exportWorking} onClick={() => void prepareExport()}>{exportPreparing ? "Checking assets…" : "Export with passkey"}</button>}
      {exportJob && <KnowledgeExportPreparationStatus
        job={exportJob}
        onDownload={() => setMessage("Archive download started.")}
        onRetry={() => void retryExport()}
        onReset={() => setExportJob(null)}
      />}
    </section>
    <section><h2>Import full archive</h2>
      <p>Restore a full archive onto a fresh Context Use instance. This replaces only the destination knowledge base; account credentials and integrations stay local to the new instance.</p>
      <p><strong>Important:</strong> the untouched default template is okay, but import becomes unavailable after you add or change knowledge or assets.</p>
      <div className="archive-import">
        {importEligibilityError
          ? <p className="error" role="alert">{importEligibilityError}</p>
          : importEligible === null
            ? <p className="archive-import-checking" role="status">Checking import availability…</p>
            : !importEligible
              ? <div className="archive-import-locked"><strong>Import unavailable</strong><span>This knowledge base already contains personal knowledge or assets. Full archives can only be restored onto an untouched instance.</span></div>
              : <>
                <div className="archive-import-field">
                  <span className="archive-import-label">Context Use archive</span>
                  <label className={`archive-picker${importFile ? " has-file" : ""}${importPreparing || importWorking ? " is-disabled" : ""}`}>
                    <input className="archive-picker-input" type="file" accept=".zip,application/zip" aria-label="Context Use archive" disabled={importPreparing || importWorking} onChange={(event) => { setImportFile(event.currentTarget.files?.[0] ?? null); setImportError(""); }} />
                    <span className="archive-picker-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M7 3.75h7l3 3v13.5H7z" /><path d="M14 3.75v3h3M10 9.25h2m-2 2.5h2m-2 2.5h2M11 17v.01" /></svg></span>
                    <span className="archive-picker-copy">
                      <strong>{importFile ? importFile.name : "Choose a full archive"}</strong>
                      <small>{importFile ? `${formatExportBytes(importFile.size)} · Ready to validate` : "Select a .zip export from Context Use"}</small>
                    </span>
                    <span className="archive-picker-action">{importFile ? "Replace" : "Browse files"}</span>
                  </label>
                </div>
                {importError && !importIntent && <p className="error">{importError}</p>}
                <button className="primary" disabled={!importFile || importPreparing || importWorking} onClick={() => void prepareImport()}>{importPreparing ? "Validating and staging…" : "Validate archive"}</button>
              </>}
      </div>
    </section>
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
      title={exportIntent.summary.kind === "restorable" ? "Download a full restorable archive?" : "Download your knowledge snapshot?"}
      description={exportIntent.summary.kind === "restorable"
        ? "The ZIP can recreate the complete knowledge state on a fresh instance, including private history and publication state. It is unencrypted and requires a fresh owner-passkey verification."
        : "The ZIP contains the current private and public knowledge as a readable Markdown vault. It is unencrypted and requires a fresh owner-passkey verification."}
      confirmLabel="Verify passkey and download"
      workingLabel="Waiting for passkey…"
      working={exportWorking}
      error={exportError}
      onCancel={() => { setExportError(""); setExportIntent(null); }}
      onConfirm={() => void downloadExport()}
    >
      <dl className="action-dialog-details">
        <div><dt>{exportIntent.summary.kind === "restorable" ? "Pages" : "Current pages"}</dt><dd>about {exportIntent.summary.page_count}</dd></div>
        <div><dt>Active assets</dt><dd>about {exportIntent.summary.asset_count}</dd></div>
        <div><dt>Size</dt><dd>about {formatExportBytes(exportIntent.summary.total_bytes)}</dd></div>
      </dl>
    </ActionDialog>}
    {importIntent && <ActionDialog
      eyebrow="Full knowledge restore"
      title="Replace this instance’s knowledge?"
      description="The archive passed structural and integrity checks. A fresh owner-passkey verification is required. The restore is allowed only on an untouched instance and preserves the source IDs, retained history, archived content, internal links, asset metadata, and publication state."
      confirmLabel="Verify passkey and restore"
      workingLabel="Restoring knowledge…"
      working={importWorking}
      error={importError}
      onCancel={() => void cancelImport()}
      onConfirm={() => void restoreImport()}
    >
      <dl className="action-dialog-details">
        <div><dt>Pages</dt><dd>{importIntent.summary.pages}</dd></div>
        <div><dt>Retained versions</dt><dd>{importIntent.summary.page_versions}</dd></div>
        <div><dt>Active assets</dt><dd>{importIntent.summary.active_assets}</dd></div>
        <div><dt>Asset bytes</dt><dd>{formatExportBytes(importIntent.summary.active_asset_bytes)}</dd></div>
      </dl>
    </ActionDialog>}
  </main>;
}
