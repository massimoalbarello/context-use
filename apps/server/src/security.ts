import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config.ts";
import type { DashboardPrincipal } from "./auth.ts";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function requestMatchesOrigin(request: Request, expectedOrigin: string): boolean {
  const actual = new URL(request.url);
  const expected = new URL(expectedOrigin);
  if (actual.host !== expected.host) return false;
  if (actual.protocol === expected.protocol) return true;
  return actual.protocol === "http:"
    && expected.protocol === "https:"
    && request.headers.get("x-forwarded-proto") === "https";
}

function constantTimeTextEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function csrfToken(principal: DashboardPrincipal): string {
  return createHmac("sha256", config.BETTER_AUTH_SECRET)
    .update(`dashboard-csrf\0${principal.sessionId}\0${principal.userId}`)
    .digest("base64url");
}

function assertDashboardMutationSource(request: Request, principal: DashboardPrincipal): void {
  if (request.headers.get("origin") !== config.APP_ORIGIN) throw new SecurityError("Untrusted origin", 403);
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== "same-origin") throw new SecurityError("Missing or cross-site Fetch Metadata", 403);
  const supplied = request.headers.get("x-csrf-token") ?? "";
  if (!constantTimeTextEqual(supplied, csrfToken(principal))) throw new SecurityError("Invalid CSRF token", 403);
}

export function assertDashboardRequestSecurity(request: Request, principal: DashboardPrincipal): void {
  if (!MUTATING.has(request.method)) return;
  assertDashboardMutationSource(request, principal);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new SecurityError("JSON content type required", 415);
  }
}

export function assertDashboardUploadSecurity(request: Request, principal: DashboardPrincipal): void {
  assertDashboardMutationSource(request, principal);
}

export class SecurityError extends Error {
  constructor(message: string, readonly status = 401) {
    super(message);
    this.name = "SecurityError";
  }
}

export const securityHeaders = {
  "cache-control": "no-store",
  "content-security-policy": [
    "default-src 'self'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `img-src 'self' data: ${config.ASSET_ORIGIN}`,
    `media-src 'self' blob: ${config.ASSET_ORIGIN}`,
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "connect-src 'self'",
  ].join("; "),
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};
