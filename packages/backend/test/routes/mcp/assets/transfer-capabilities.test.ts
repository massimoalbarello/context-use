import { expect, test } from 'bun:test';
import type { McpClientAuthorizationPrincipal } from '#models/mcp-client-authorizations/model.ts';
import { AssetTransferCapabilities } from '#routes/mcp/assets/transfer-capabilities.ts';

const START_TIME = Date.parse('2026-09-01T12:00:00.000Z');
const CAPABILITY_LIFETIME_MILLISECONDS = 30_000;

const principal: McpClientAuthorizationPrincipal = {
  ownerId: 'internal-owner-id',
  clientAuthorizationId: 'internal-client-authorization-id',
  clientAuthorizationName: 'Research agent',
};

test('asset transfer capabilities preserve principal binding and reject expiry and replay', () => {
  let now = START_TIME;
  const tokens = [
    'upload-request',
    'upload-secret',
    'download-request',
    'download-secret',
    'expired-request',
    'expired-secret',
  ];
  const capabilities = new AssetTransferCapabilities({
    baseUrl: new URL('https://context-use.example/some-ignored-path'),
    lifetimeMilliseconds: CAPABILITY_LIFETIME_MILLISECONDS,
    now: () => now,
    token: () => tokens.shift() ?? 'unexpected-secret',
  });

  const upload = capabilities.issueUpload({
    principal,
    name: 'Quarterly chart',
    allowDuplicate: true,
  });
  expect(upload).toEqual({
    url: 'https://context-use.example/mcp/asset-transfers/uploads/upload-request',
    secret: 'upload-secret',
    expiresAt: '2026-09-01T12:00:30.000Z',
  });
  expect(upload.url).not.toContain(principal.ownerId);
  expect(upload.url).not.toContain(principal.clientAuthorizationId);
  expect(upload.url).not.toContain(upload.secret);

  const consumedUpload = capabilities.consumeUpload({
    requestId: 'upload-request',
    secret: 'upload-secret',
  });
  expect(consumedUpload).toEqual({
    state: 'valid',
    capability: {
      kind: 'upload',
      principal,
      name: 'Quarterly chart',
      allowDuplicate: true,
      expiresAtMilliseconds: START_TIME + CAPABILITY_LIFETIME_MILLISECONDS,
    },
  });
  expect(
    capabilities.consumeUpload({ requestId: 'upload-request', secret: 'upload-secret' }),
  ).toEqual({ state: 'invalid' });

  capabilities.issueDownload({ principal, readableId: 'quarterly-chart' });
  expect(
    capabilities.consumeDownload({ requestId: 'download-request', secret: 'wrong-secret' }),
  ).toEqual({ state: 'invalid' });
  expect(
    capabilities.consumeDownload({ requestId: 'download-request', secret: 'download-secret' }),
  ).toEqual({ state: 'invalid' });

  capabilities.issueUpload({ principal, name: 'Expired asset' });
  now += CAPABILITY_LIFETIME_MILLISECONDS;
  expect(
    capabilities.consumeUpload({ requestId: 'expired-request', secret: 'expired-secret' }),
  ).toEqual({ state: 'invalid' });
});
