import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { formatExportBytes, Settings } from "./Settings.tsx";

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
});
