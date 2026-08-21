import { startAuthentication } from "@simplewebauthn/browser";
import { useEffect, useState } from "react";
import { api, ApiError, uploadKnowledgeArchive } from "../api.ts";
import { ActionDialog } from "./ActionDialog.tsx";
import { KnowledgeTemplateSettings } from "./KnowledgeTemplate.tsx";
import { RunningRelease } from "./RunningRelease.tsx";
import { IntrinsicServices } from "./Services.tsx";

export type PasskeySummary = {
  id: string;
  name: string | null;
  created_at: string;
  device_type: string;
  backed_up: boolean;
};

type ClearableKnowledge = {
  page_count: number;
  archived_page_count: number;
  directory_count: number;
  asset_count: number;
  published_page_count: number;
  published_asset_count: number;
};

type KnowledgeExportIntent = {
  intent: { id: string; expires_at: string };
  summary: {
    kind: "portable" | "restorable";
    reset: boolean;
    page_count: number;
    asset_count: number;
    total_bytes: number;
  };
  knowledge: ClearableKnowledge | null;
  authentication_options: Parameters<typeof startAuthentication>[0]["optionsJSON"];
};

type KnowledgeExportConfirmation = {
  download_url: string;
};

type KnowledgeResetState = { archive_downloaded: boolean; cleared: boolean };

type KnowledgeExportStatus = { reset?: KnowledgeResetState } & (
  | { status: "processing"; status_url: string }
  | { status: "ready"; download_url: string; filename: string; size_bytes: number }
  | { status: "failed"; message: string; code: string }
);

type PublicEntrypoint = {
  settings: {
    entrypoint_page_id: string | null;
    current_path: string | null;
    public_path: string | null;
    title: string | null;
    summary: string | null;
  } | null;
  candidates: Array<{
    id: string;
    public_path: string;
    title: string;
    summary: string;
  }>;
};

export type KnowledgeExportJob = {
  intentId: string;
  kind: "portable" | "restorable";
  status: "processing" | "ready" | "failed";
  downloadUrl: string;
  filename?: string | undefined;
  sizeBytes?: number | undefined;
  error?: string | undefined;
  // A reset job is the same export, carrying the gate the clear waits on.
  reset: boolean;
  archiveDownloaded: boolean;
};

const exportJobStorageKey = "context-use.knowledge-export-job";
export const CLEAR_KNOWLEDGE_PHRASE = "CLEAR EVERYTHING";

export function storedExportJob(storage?: Pick<Storage, "getItem"> | null): KnowledgeExportJob | null {
  try {
    const source = storage === undefined
      ? typeof window === "undefined" ? null : window.localStorage
      : storage;
    if (!source) return null;
    const value = JSON.parse(source.getItem(exportJobStorageKey) ?? "null") as Partial<KnowledgeExportJob> | null;
    if (!value || typeof value.intentId !== "string" || !/^[a-f0-9-]{36}$/.test(value.intentId)
        || (value.kind !== "portable" && value.kind !== "restorable")) return null;
    return {
      intentId: value.intentId,
      kind: value.kind,
      status: "processing",
      downloadUrl: `/api/dashboard/knowledge-exports/${encodeURIComponent(value.intentId)}/download`,
      // Both are re-read from the intent, so a stale entry can never unlock a clear.
      reset: value.reset === true,
      archiveDownloaded: false,
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

export type ArchiveImportProgress = {
  loaded: number;
  total: number;
  startedAt: number;
  updatedAt: number;
};

function formatTransferEstimate(seconds: number): string {
  if (seconds < 60) return `about ${Math.max(1, Math.round(seconds))}s left`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `about ${minutes} min left`;
  const hours = Math.floor(minutes / 60);
  return `about ${hours}h ${minutes % 60}m left`;
}

export function archiveImportProgressCopy(progress: ArchiveImportProgress): {
  percent: number;
  determinate: boolean;
  headline: string;
  detail: string;
} {
  const total = Math.max(progress.total, 1);
  const loaded = Math.min(progress.loaded, total);
  const percent = Math.min(99, Math.floor((loaded / total) * 100));
  if (loaded >= total) {
    return {
      percent: 100,
      determinate: false,
      headline: "Finishing validation and staging…",
      detail: "The whole archive reached the server. It is checking the manifest and writing the last staged assets — for a large archive this can take a few more minutes. Keep this tab open.",
    };
  }
  const elapsedSeconds = Math.max(0, progress.updatedAt - progress.startedAt) / 1000;
  const rate = elapsedSeconds >= 1 ? loaded / elapsedSeconds : 0;
  const parts = [`${formatExportBytes(loaded)} of ${formatExportBytes(total)}`];
  if (rate > 0) {
    parts.push(`${formatExportBytes(rate)}/s`);
    parts.push(formatTransferEstimate((total - loaded) / rate));
  }
  return {
    percent,
    determinate: true,
    headline: `Uploading and validating… ${percent}%`,
    detail: parts.join(" · "),
  };
}

export function ArchiveImportProgressStatus({ progress }: { progress: ArchiveImportProgress }) {
  const { percent, determinate, headline, detail } = archiveImportProgressCopy(progress);
  return <div className="archive-upload" role="status" aria-live="polite">
    <div className="archive-upload-copy">
      <strong>{headline}</strong>
      <small>{detail}</small>
    </div>
    <div
      className={`archive-upload-track${determinate ? "" : " is-indeterminate"}`}
      role="progressbar"
      aria-label="Archive validation progress"
      aria-valuemin={determinate ? 0 : undefined}
      aria-valuemax={determinate ? 100 : undefined}
      aria-valuenow={determinate ? percent : undefined}
    >
      <span className="archive-upload-fill" style={determinate ? { width: `${percent}%` } : undefined} />
    </div>
    <small className="archive-upload-note">Leaving this page stops the import. Nothing is written to the knowledge base until you confirm with a passkey.</small>
  </div>;
}

function exportPreparationCopy(job: KnowledgeExportJob): { headline: string; detail: string } {
  const archive = `${job.filename ?? ""}${job.sizeBytes ? ` · ${formatExportBytes(job.sizeBytes)}` : ""}`;
  if (job.status === "failed") {
    return { headline: "Archive preparation stopped", detail: "" };
  }
  if (job.status === "processing") {
    return {
      headline: job.reset
        ? "Step 1 of 2 · Preparing the full archive…"
        : `Preparing ${job.kind === "restorable" ? "full archive" : "latest snapshot"}…`,
      detail: job.reset
        ? "Nothing has been deleted yet. The knowledge base is cleared only after this archive reaches you."
        : "The ZIP is being assembled and checked. You can leave Settings and return while this export remains available.",
    };
  }
  if (!job.reset) return { headline: "Archive ready to download", detail: archive };
  return job.archiveDownloaded
    ? {
        headline: "Step 2 of 2 · Archive downloaded",
        detail: "Keep this file somewhere safe. Clearing the knowledge base is irreversible.",
      }
    : {
        headline: "Step 2 of 2 · Download the archive",
        detail: `${archive} · Clearing unlocks once the download finishes.`,
      };
}

export function KnowledgeExportPreparationStatus({
  job,
  onDownload,
  onReset,
  onClear,
}: {
  job: KnowledgeExportJob;
  onDownload: () => void;
  onReset: () => void;
  onClear?: (() => void) | undefined;
}) {
  const { headline, detail } = exportPreparationCopy(job);
  return <div className={`export-preparation ${job.status}`} role="status" aria-live="polite">
    <div className="export-preparation-copy">
      {job.status === "processing" && <span className="export-spinner" aria-hidden="true" />}
      <div>
        <strong>{headline}</strong>
        {job.status === "failed"
          ? <small className="error">{job.error || "The archive could not be prepared."}</small>
          : detail && <small>{detail}</small>}
      </div>
    </div>
    {job.status === "ready" && <div className="export-preparation-actions">
      <a className={`button${job.reset ? "" : " primary"}`} href={job.downloadUrl} onClick={onDownload}>
        {job.reset && job.archiveDownloaded ? "Download again" : "Download archive"}
      </a>
      {onClear && <button className="danger" disabled={!job.archiveDownloaded} onClick={onClear}>Clear knowledge base</button>}
      <button onClick={onReset}>{job.reset ? "Cancel" : "Prepare another"}</button>
    </div>}
    {job.status === "failed" && <div className="export-preparation-actions">
      <button className="primary" onClick={onReset}>{job.reset ? "Cancel" : "Start over"}</button>
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
  const [exportJob, setExportJob] = useState<KnowledgeExportJob | null>(storedExportJob);
  const [exportKind, setExportKind] = useState<"portable" | "restorable">(() => exportJob?.kind ?? "portable");
  const [exportPreparing, setExportPreparing] = useState(false);
  const [exportWorking, setExportWorking] = useState(false);
  const [exportError, setExportError] = useState("");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importIntent, setImportIntent] = useState<KnowledgeImportIntent | null>(null);
  const [importPreparing, setImportPreparing] = useState(false);
  const [importProgress, setImportProgress] = useState<ArchiveImportProgress | null>(null);
  const [importWorking, setImportWorking] = useState(false);
  const [importError, setImportError] = useState("");
  const [importEligible, setImportEligible] = useState<boolean | null>(null);
  const [importEligibilityError, setImportEligibilityError] = useState("");
  const [resetPhrase, setResetPhrase] = useState("");
  const [clearPrompted, setClearPrompted] = useState(false);
  const [clearWorking, setClearWorking] = useState(false);
  const [clearError, setClearError] = useState("");
  const [publicEntrypoint, setPublicEntrypoint] = useState<PublicEntrypoint | null>(null);
  const [publicEntrypointId, setPublicEntrypointId] = useState("");
  const [publicEntrypointWorking, setPublicEntrypointWorking] = useState(false);
  const [publicEntrypointError, setPublicEntrypointError] = useState("");

  const refreshImportEligibility = () => api<{ eligible: boolean }>("/api/dashboard/knowledge-import-eligibility");

  useEffect(() => {
    let active = true;
    refreshImportEligibility()
      .then(({ eligible }) => { if (active) setImportEligible(eligible); })
      .catch(() => { if (active) setImportEligibilityError("Import availability could not be checked. Reload Settings to try again."); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    api<PublicEntrypoint>("/api/dashboard/public-entrypoint")
      .then((result) => {
        if (!active) return;
        setPublicEntrypoint(result);
        setPublicEntrypointId(result.settings?.entrypoint_page_id ?? "");
      })
      .catch((error: unknown) => {
        if (active) setPublicEntrypointError(error instanceof Error ? error.message : "Public entry point could not be loaded");
      });
    return () => { active = false; };
  }, []);

  const savePublicEntrypoint = async () => {
    setPublicEntrypointWorking(true);
    setPublicEntrypointError("");
    try {
      const result = await api<{ settings: PublicEntrypoint["settings"] }>("/api/dashboard/public-entrypoint", {
        method: "PUT",
        body: JSON.stringify({ page_id: publicEntrypointId || null }),
      });
      setPublicEntrypoint((current) => current ? { ...current, settings: result.settings } : current);
      setMessage(publicEntrypointId ? "Public entry point updated." : "Public entry point removed.");
    } catch (error) {
      setPublicEntrypointError(error instanceof Error ? error.message : "Public entry point could not be updated");
    } finally {
      setPublicEntrypointWorking(false);
    }
  };

  useEffect(() => {
    try {
      if (exportJob) {
        window.localStorage.setItem(exportJobStorageKey, JSON.stringify({
          intentId: exportJob.intentId,
          kind: exportJob.kind,
          reset: exportJob.reset,
        }));
      } else {
        window.localStorage.removeItem(exportJobStorageKey);
      }
    } catch {
      // The server-side intent remains resumable even when browser storage is unavailable.
    }
  }, [exportJob?.intentId, exportJob?.kind, exportJob?.reset]);

  useEffect(() => {
    // A reset keeps polling past "ready": the clear waits on the server's own
    // record that the archive was delivered, not on the download click.
    const pending = exportJob && (
      exportJob.status === "processing"
      || (exportJob.reset && exportJob.status === "ready" && !exportJob.archiveDownloaded)
    );
    if (!exportJob || !pending) return;
    const { intentId } = exportJob;
    let active = true;
    let timeout: number | undefined;
    const poll = async () => {
      try {
        const status = await api<KnowledgeExportStatus>(
          `/api/dashboard/knowledge-exports/${encodeURIComponent(intentId)}/status`,
        );
        if (!active) return;
        if (status.reset?.cleared) {
          setExportJob((current) => current?.intentId === intentId ? null : current);
          return;
        }
        setExportJob((current) => {
          if (!current || current.intentId !== intentId) return current;
          const archiveDownloaded = status.reset?.archive_downloaded ?? current.archiveDownloaded;
          if (status.status === "ready") {
            return {
              ...current,
              status: "ready",
              downloadUrl: status.download_url,
              filename: status.filename,
              sizeBytes: status.size_bytes,
              error: undefined,
              archiveDownloaded,
            };
          }
          if (status.status === "failed") {
            return { ...current, status: "failed", error: status.message, archiveDownloaded };
          }
          return archiveDownloaded === current.archiveDownloaded ? current : { ...current, archiveDownloaded };
        });
      } catch (error) {
        if (!active) return;
        if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
          setExportJob((current) => current?.intentId === intentId ? null : current);
          setMessage(error.message);
          return;
        }
      }
      if (active) timeout = window.setTimeout(() => void poll(), 2_000);
    };
    void poll();
    return () => {
      active = false;
      if (timeout !== undefined) window.clearTimeout(timeout);
    };
  }, [exportJob?.intentId, exportJob?.status, exportJob?.reset, exportJob?.archiveDownloaded]);

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

  const prepareExport = async (reset = false) => {
    setExportPreparing(true);
    setExportError("");
    setResetPhrase("");
    setMessage("");
    try {
      setExportIntent(await api<KnowledgeExportIntent>("/api/dashboard/knowledge-export-intents", {
        method: "POST",
        body: JSON.stringify(reset ? { reset: true } : { kind: exportKind }),
      }));
    } catch (error) {
      setMessage(error instanceof Error
        ? error.message
        : `Could not prepare the knowledge ${reset ? "reset" : "export"}`);
    } finally {
      setExportPreparing(false);
    }
  };

  const cancelExportIntent = async () => {
    if (!exportIntent || exportWorking) return;
    const { id } = exportIntent.intent;
    setExportIntent(null);
    setExportError("");
    setResetPhrase("");
    await api(`/api/dashboard/knowledge-export-intents/${encodeURIComponent(id)}`, {
      method: "DELETE",
      body: "{}",
    }).catch(() => undefined);
  };

  const clearKnowledge = async () => {
    if (!exportJob) return;
    setClearWorking(true);
    setClearError("");
    try {
      const result = await api<{ template_error: string | null }>(
        `/api/dashboard/knowledge-resets/${encodeURIComponent(exportJob.intentId)}/clear`,
        { method: "POST", body: "{}" },
      );
      setClearPrompted(false);
      setExportJob(null);
      setMessage(result.template_error
        ?? "The knowledge base was cleared and rebuilt from the default template. A full archive can now be imported.");
      await onKnowledgeChanged();
      await refreshImportEligibility()
        .then(({ eligible }) => setImportEligible(eligible))
        .catch(() => undefined);
    } catch (error) {
      setClearError(error instanceof Error ? error.message : "The knowledge base could not be cleared");
    } finally {
      setClearWorking(false);
    }
  };

  const prepareImport = async () => {
    if (!importFile) {
      setImportError("Choose a full Context Use archive first.");
      return;
    }
    const startedAt = Date.now();
    setImportPreparing(true);
    setImportProgress({ loaded: 0, total: importFile.size, startedAt, updatedAt: startedAt });
    setImportError("");
    setMessage("");
    try {
      setImportIntent(await uploadKnowledgeArchive<KnowledgeImportIntent>(importFile, (loaded, total) => {
        setImportProgress({ loaded, total, startedAt, updatedAt: Date.now() });
      }));
    } catch (error) {
      if (error instanceof ApiError && error.code === "import_requires_fresh_instance") {
        setImportFile(null);
        setImportEligible(false);
        return;
      }
      setImportError(error instanceof Error ? error.message : "Could not validate the knowledge archive");
    } finally {
      setImportPreparing(false);
      setImportProgress(null);
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
      const { kind, reset } = exportIntent.summary;
      setExportIntent(null);
      setResetPhrase("");
      setMessage("");
      setExportJob({
        intentId,
        kind,
        status: "processing",
        downloadUrl: confirmed.download_url,
        reset,
        archiveDownloaded: false,
      });
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Knowledge export failed");
    } finally {
      setExportWorking(false);
    }
  };
  return <main className="content-page settings-page"><header><div><span className="eyebrow">Owner-only controls</span><h1>Settings</h1></div><RunningRelease /></header>
    {message && <p>{message}</p>}
    <IntrinsicServices />
    <section><h2>Public entry point</h2>
      <p>Choose which already-published page introduces the public knowledge base. Publishing and editing remain separate decisions; this pointer never publishes private content.</p>
      {publicEntrypointError && <p className="error" role="alert">{publicEntrypointError}</p>}
      {publicEntrypoint && <div className="public-entrypoint-setting">
        <label>Entry page<select value={publicEntrypointId} onChange={(event) => setPublicEntrypointId(event.target.value)}>
          <option value="">No public entry point</option>
          {publicEntrypoint.candidates.map((page) => <option value={page.id} key={page.id}>{page.title} · /p/{page.public_path}</option>)}
        </select></label>
        <button className="primary" disabled={publicEntrypointWorking || publicEntrypointId === (publicEntrypoint.settings?.entrypoint_page_id ?? "")} onClick={() => void savePublicEntrypoint()}>{publicEntrypointWorking ? "Saving…" : "Save entry point"}</button>
      </div>}
    </section>
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
      {exportJob?.reset && <p className="archive-import-checking">A knowledge reset is preparing its archive. Finish or cancel it before starting another export.</p>}
      {exportJob && !exportJob.reset && <KnowledgeExportPreparationStatus
        job={exportJob}
        onDownload={() => {
          try { window.localStorage.removeItem(exportJobStorageKey); } catch { /* Browser storage may be unavailable. */ }
          setMessage("Archive download started.");
        }}
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
                <button className="primary" disabled={!importFile || importPreparing || importWorking} onClick={() => void prepareImport()}>{importPreparing ? "Validating archive…" : "Validate archive"}</button>
                {importProgress && <ArchiveImportProgressStatus progress={importProgress} />}
              </>}
      </div>
    </section>
    <section className="danger-zone"><h2>Clear knowledge base</h2>
      <p>This permanently removes every page, version, asset, publication, and the whole change history, leaving only the default template. It cannot be undone from inside Context Use.</p>
      <p><strong>The full restorable archive is exported first and is not optional.</strong> After one passkey verification the archive is prepared, and the knowledge base can only be cleared once that download has finished. Keep the file: importing it back is the only way to recover this knowledge base.</p>
      {!exportJob && <button className="danger export-start-button" disabled={exportPreparing || exportWorking} onClick={() => void prepareExport(true)}>{exportPreparing ? "Checking assets…" : "Export archive and clear…"}</button>}
      {exportJob && !exportJob.reset && <p className="archive-import-checking">An export is in progress. Finish or reset it before clearing the knowledge base.</p>}
      {exportJob?.reset && <KnowledgeExportPreparationStatus
        job={exportJob}
        onDownload={() => setMessage("Archive download started.")}
        onReset={() => { setExportJob(null); setClearError(""); }}
        onClear={() => { setClearError(""); setClearPrompted(true); }}
      />}
      {clearError && !clearPrompted && <p className="error" role="alert">{clearError}</p>}
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
    {exportIntent && !exportIntent.knowledge && <ActionDialog
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
    {exportIntent?.knowledge && <ActionDialog
      eyebrow="Clear knowledge base"
      title="Delete everything in this knowledge base?"
      description={<>
        <p>Verifying your passkey starts the mandatory full archive. Nothing is deleted until you download it and confirm again.</p>
        <p>Clearing removes every page and its history, every archived page, every asset file, and unpublishes everything currently public. Only the default template remains. Passkeys, integrations, and automations are untouched.</p>
      </>}
      confirmLabel="Verify passkey and export archive"
      workingLabel="Waiting for passkey…"
      confirmTone="danger"
      confirmDisabled={resetPhrase.trim().toUpperCase() !== CLEAR_KNOWLEDGE_PHRASE}
      working={exportWorking}
      error={exportError}
      onCancel={() => void cancelExportIntent()}
      onConfirm={() => void downloadExport()}
    >
      <dl className="action-dialog-details">
        <div><dt>Active pages</dt><dd>{exportIntent.knowledge.page_count}</dd></div>
        <div><dt>Archived pages</dt><dd>{exportIntent.knowledge.archived_page_count}</dd></div>
        <div><dt>Directories</dt><dd>{exportIntent.knowledge.directory_count}</dd></div>
        <div><dt>Active assets</dt><dd>{exportIntent.knowledge.asset_count}</dd></div>
        <div><dt>Published pages</dt><dd>{exportIntent.knowledge.published_page_count}</dd></div>
        <div><dt>Published assets</dt><dd>{exportIntent.knowledge.published_asset_count}</dd></div>
        <div><dt>Archive size</dt><dd>about {formatExportBytes(exportIntent.summary.total_bytes)}</dd></div>
      </dl>
      <label className="reset-phrase">Type <strong>{CLEAR_KNOWLEDGE_PHRASE}</strong> to continue
        <input
          autoComplete="off"
          spellCheck={false}
          aria-label={`Type ${CLEAR_KNOWLEDGE_PHRASE} to continue`}
          value={resetPhrase}
          disabled={exportWorking}
          onChange={(event) => setResetPhrase(event.target.value)}
        />
      </label>
    </ActionDialog>}
    {clearPrompted && exportJob?.reset && <ActionDialog
      eyebrow="Clear knowledge base"
      title="Clear the knowledge base now?"
      description="Your full archive has been downloaded. This deletes all pages, versions, assets, publications, and history, then rebuilds the default template. Importing the archive you just downloaded is the only way back."
      confirmLabel="Clear knowledge base"
      workingLabel="Clearing knowledge…"
      confirmTone="danger"
      working={clearWorking}
      error={clearError}
      onCancel={() => { setClearError(""); setClearPrompted(false); }}
      onConfirm={() => void clearKnowledge()}
    />}
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
