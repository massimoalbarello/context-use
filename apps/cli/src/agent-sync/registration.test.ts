import { expect, test } from "bun:test";

import {
  activeAgentSyncMetadata,
  agentSyncConnectionId,
  agentSyncTokenVerifier,
  assertAgentSyncActivationAllowed,
  isAgentSyncConnectionId,
  newAgentSyncInstanceId,
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
  })).toThrow("different local credential");
  expect(() => assertAgentSyncActivationAllowed({
    connectionExists: true,
    metadata,
    localToken: "b".repeat(43),
    deploymentId: "deployment",
  })).toThrow("different local credential");
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

test("new installations receive stable-shape machine-scoped connection identities", () => {
  const instanceId = newAgentSyncInstanceId();
  expect(instanceId).toMatch(/^[a-f0-9]{32}$/);
  expect(agentSyncConnectionId(instanceId)).toBe(`agent-sync-${instanceId}`);
  expect(isAgentSyncConnectionId("agent-sync")).toBe(true);
  expect(isAgentSyncConnectionId(`agent-sync-${instanceId}`)).toBe(true);
  expect(isAgentSyncConnectionId("agent-sync-owner-mac")).toBe(false);
  expect(() => agentSyncConnectionId("owner-mac")).toThrow("Invalid agent-sync instance ID");
});

test("instance metadata binds a connection credential to one local identity", () => {
  const token = "c".repeat(43);
  const instanceId = "d".repeat(32);
  const metadata = activeAgentSyncMetadata({
    token,
    deploymentId: "deployment",
    instanceId,
    label: "second-laptop",
    version: "v1.2.3",
  });
  expect(metadata.instance_id).toBe(instanceId);
  expect(parseAgentSyncMetadata(metadata)).toEqual(metadata);
  expect(() => assertAgentSyncActivationAllowed({
    connectionExists: true,
    metadata,
    localToken: token,
    deploymentId: "deployment",
    instanceId,
  })).not.toThrow();
  expect(() => assertAgentSyncActivationAllowed({
    connectionExists: true,
    metadata,
    localToken: token,
    deploymentId: "deployment",
    instanceId: "e".repeat(32),
  })).toThrow("different local instance");
});
