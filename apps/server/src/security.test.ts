import { describe, expect, test } from "bun:test";
import type { DashboardPrincipal } from "./auth.ts";
import {
  SecurityError,
  assertDashboardRequestSecurity,
  assertDashboardUploadSecurity,
  csrfToken,
} from "./security.ts";

const principal: DashboardPrincipal = { userId: "owner", sessionId: "session", email: "owner@example.com" };

function mutation(headers: Record<string, string>) {
  return new Request("http://localhost:3000/api/dashboard/pages", {
    method: "POST",
    headers,
    body: "{}",
  });
}

describe("dashboard mutation boundary", () => {
  test("accepts the same session's CSRF token with exact browser metadata", () => {
    expect(() => assertDashboardRequestSecurity(mutation({
      origin: "http://localhost:3000",
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
      "x-csrf-token": csrfToken(principal),
    }), principal)).not.toThrow();
  });

  for (const [name, headers] of [
    ["missing origin", { "sec-fetch-site": "same-origin", "content-type": "application/json", "x-csrf-token": csrfToken(principal) }],
    ["hostile origin", { origin: "https://attacker.example", "sec-fetch-site": "same-origin", "content-type": "application/json", "x-csrf-token": csrfToken(principal) }],
    ["missing Fetch Metadata", { origin: "http://localhost:3000", "content-type": "application/json", "x-csrf-token": csrfToken(principal) }],
    ["cross-site Fetch Metadata", { origin: "http://localhost:3000", "sec-fetch-site": "cross-site", "content-type": "application/json", "x-csrf-token": csrfToken(principal) }],
    ["missing CSRF", { origin: "http://localhost:3000", "sec-fetch-site": "same-origin", "content-type": "application/json" }],
    ["non-JSON body", { origin: "http://localhost:3000", "sec-fetch-site": "same-origin", "content-type": "text/plain", "x-csrf-token": csrfToken(principal) }],
  ] as const) {
    test(`rejects ${name}`, () => {
      expect(() => assertDashboardRequestSecurity(mutation(headers), principal)).toThrow(SecurityError);
    });
  }

  test("accepts a checksum-bound same-origin file upload without requiring JSON", () => {
    const request = new Request("http://localhost:3000/api/dashboard/assets/11111111-1111-4111-8111-111111111111/content", {
      method: "PUT",
      headers: {
        origin: "http://localhost:3000",
        "sec-fetch-site": "same-origin",
        "content-type": "application/pdf",
        "x-csrf-token": csrfToken(principal),
      },
      body: "pdf bytes",
    });
    expect(() => assertDashboardUploadSecurity(request, principal)).not.toThrow();
  });
});
