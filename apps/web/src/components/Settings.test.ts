import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CLEAR_KNOWLEDGE_PHRASE,
  formatExportBytes,
  KnowledgeExportPreparationStatus,
  Settings,
  storedExportJob,
  type KnowledgeExportJob,
} from "./Settings.tsx";

const processing: KnowledgeExportJob = {
  intentId: "11111111-1111-4111-8111-111111111111",
  kind: "portable",
  status: "processing",
  downloadUrl: "/api/dashboard/knowledge-exports/11111111-1111-4111-8111-111111111111/download",
  reset: false,
  archiveDownloaded: false,
};

const noop = () => undefined;

describe("knowledge export settings", () => {
  test("formats the current export size for passkey review", () => {
    expect(formatExportBytes(0)).toBe("0 B");
    expect(formatExportBytes(1024)).toBe("1.00 KB");
    expect(formatExportBytes(5_000_000_000)).toBe("4.66 GB");
  });

  test("recovers a confirmed export after Settings is remounted", () => {
    const intentId = "11111111-1111-4111-8111-111111111111";
    const recovered = storedExportJob({
      getItem: () => JSON.stringify({ intentId, kind: "restorable" }),
    });
    expect(recovered).toEqual({
      intentId,
      kind: "restorable",
      status: "processing",
      downloadUrl: `/api/dashboard/knowledge-exports/${intentId}/download`,
      reset: false,
      archiveDownloaded: false,
    });
    expect(storedExportJob({ getItem: () => "not json" })).toBeNull();
  });

  test("does not expose archive input before eligibility is confirmed", () => {
    const html = renderToStaticMarkup(createElement(Settings, {
      passkeys: [],
      onPasskeysChanged: async () => undefined,
      onKnowledgeChanged: async () => undefined,
    }));
    expect(html).toContain("Checking import availability…");
    expect(html).not.toContain('type="file"');
  });

  test("shows explicit processing feedback without exposing a premature download", () => {
    const html = renderToStaticMarkup(KnowledgeExportPreparationStatus({
      job: processing,
      onDownload: noop,
      onReset: noop,
    }));
    expect(html).toContain("Preparing latest snapshot");
    expect(html).toContain("leave Settings and return");
    expect(html).toContain('role="status"');
    expect(html).not.toContain("Download archive");
  });

  test("reveals the resumable download link only when the archive is ready", () => {
    const html = renderToStaticMarkup(KnowledgeExportPreparationStatus({
      job: {
        ...processing,
        kind: "restorable",
        status: "ready",
        filename: "context-use-full-archive-2026-08-13.zip",
        sizeBytes: 5_000_000_000,
      },
      onDownload: noop,
      onReset: noop,
    }));
    expect(html).toContain("Archive ready to download");
    expect(html).toContain("context-use-full-archive-2026-08-13.zip · 4.66 GB");
    expect(html).toContain(`href="${processing.downloadUrl}"`);
    expect(html).toContain("Download archive");
  });
});

describe("knowledge base reset settings", () => {
  const resetJob: KnowledgeExportJob = {
    ...processing,
    kind: "restorable",
    status: "ready",
    filename: "context-use-full-archive-2026-08-13.zip",
    sizeBytes: 5_000_000_000,
    reset: true,
  };

  test("resumes an authorized reset after Settings is remounted, unlocking nothing", () => {
    const intentId = "22222222-2222-4222-8222-222222222222";
    // Resuming never restores the delivery mark; the server is asked again.
    expect(storedExportJob({ getItem: () => JSON.stringify({ intentId, kind: "restorable", reset: true }) })).toEqual({
      intentId,
      kind: "restorable",
      status: "processing",
      downloadUrl: `/api/dashboard/knowledge-exports/${intentId}/download`,
      reset: true,
      archiveDownloaded: false,
    });
    expect(storedExportJob({ getItem: () => JSON.stringify({ intentId: "not-a-uuid", kind: "restorable" }) })).toBeNull();
  });

  test("keeps the clear disabled until the server records the archive as delivered", () => {
    const waiting = renderToStaticMarkup(KnowledgeExportPreparationStatus({
      job: resetJob,
      onDownload: noop,
      onReset: noop,
      onClear: noop,
    }));
    expect(waiting).toContain("Step 2 of 2 · Download the archive");
    expect(waiting).toContain("Clearing unlocks once the download finishes.");
    expect(waiting).toContain("Clear knowledge base");
    expect(waiting).toContain("disabled=\"\"");

    const delivered = renderToStaticMarkup(KnowledgeExportPreparationStatus({
      job: { ...resetJob, archiveDownloaded: true },
      onDownload: noop,
      onReset: noop,
      onClear: noop,
    }));
    expect(delivered).toContain("Step 2 of 2 · Archive downloaded");
    expect(delivered).toContain("Download again");
    expect(delivered).not.toContain("disabled=\"\"");
  });

  test("warns before anything destructive is reachable", () => {
    const html = renderToStaticMarkup(createElement(Settings, {
      passkeys: [],
      onPasskeysChanged: async () => undefined,
      onKnowledgeChanged: async () => undefined,
    }));
    expect(html).toContain("Clear knowledge base");
    expect(html).toContain("full restorable archive is exported first and is not optional");
    expect(html).toContain("Export archive and clear…");
    // The clear itself is only reachable through the confirmed, downloaded archive.
    expect(html).not.toContain("Clear the knowledge base now?");
    expect(html).not.toContain(CLEAR_KNOWLEDGE_PHRASE);
  });
});
