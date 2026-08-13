import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  formatExportBytes,
  KnowledgeExportPreparationStatus,
  Settings,
  type KnowledgeExportJob,
} from "./Settings.tsx";

const processing: KnowledgeExportJob = {
  intentId: "11111111-1111-4111-8111-111111111111",
  kind: "portable",
  status: "processing",
  downloadUrl: "/api/dashboard/knowledge-exports/11111111-1111-4111-8111-111111111111/download",
};

const noop = () => undefined;

describe("knowledge export settings", () => {
  test("formats the current export size for passkey review", () => {
    expect(formatExportBytes(0)).toBe("0 B");
    expect(formatExportBytes(1024)).toBe("1.00 KB");
    expect(formatExportBytes(5_000_000_000)).toBe("4.66 GB");
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
    expect(html).toContain("ZIP is being assembled and checked");
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
