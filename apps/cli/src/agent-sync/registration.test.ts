import { expect, test } from "bun:test";

import {
  activeAgentSyncMetadata,
  agentSyncTokenVerifier,
  assertAgentSyncActivationAllowed,
  parseAgentSyncMetadata,
  revokedAgentSyncMetadata,
} from "./registration.ts";

test("registration stores only a one-way token verifier and revocation preserves identity", () => {
  const token = "secret-token-that-never-enters-nango-metadata-1234567890";
  const active = activeAgentSyncMetadata({
    token,
    deploymentId: "deployment",
    label: "laptop",
    version: "v1.2.3",
    now: new Date("2026-08-01T10:00:00Z"),
  });
  expect(active.authenticated_webhook.token_sha256).toBe(agentSyncTokenVerifier(token));
  expect(JSON.stringify(active)).not.toContain(token);
  expect(parseAgentSyncMetadata(active)).toEqual(active);
  expect(parseAgentSyncMetadata({ ...active, extra: true })).toBeNull();

  expect(revokedAgentSyncMetadata(active, "v1.2.4", new Date("2026-08-02T10:00:00Z"))).toEqual({
    ...active,
    authenticated_webhook: {
      ...active.authenticated_webhook,
      state: "revoked",
    },
    daemon_version: "v1.2.4",
    updated_at: "2026-08-02T10:00:00.000Z",
  });
});

test("an active fixed connection fails closed for a different local token", () => {
  const token = "a".repeat(43);
  const metadata = activeAgentSyncMetadata({
    token,
    deploymentId: "deployment",
    label: "first-laptop",
    version: "v1.2.3",
  });
  expect(() => assertAgentSyncActivationAllowed({
    connectionExists: true,
    metadata,
    localToken: null,
    deploymentId: "deployment",
  })).toThrow("already registered on another computer");
  expect(() => assertAgentSyncActivationAllowed({
    connectionExists: true,
    metadata,
    localToken: "b".repeat(43),
    deploymentId: "deployment",
  })).toThrow("already registered on another computer");
  expect(() => assertAgentSyncActivationAllowed({
    connectionExists: true,
    metadata,
    localToken: token,
    deploymentId: "deployment",
  })).not.toThrow();
  expect(() => assertAgentSyncActivationAllowed({
    connectionExists: true,
    metadata: null,
    localToken: token,
    deploymentId: "deployment",
  })).toThrow("unrecognized metadata");
});
