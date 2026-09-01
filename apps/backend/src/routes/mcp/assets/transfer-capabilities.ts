import { timingSafeEqual } from 'node:crypto';
import { MCP_ROUTE_PATH } from '#lib/auth/better-auth.ts';
import type { McpClientAuthorizationPrincipal } from '#models/mcp-client-authorizations/model.ts';

const CAPABILITY_BYTES = 32;
const DEFAULT_CAPABILITY_LIFETIME_MINUTES = 5;
const SECONDS_PER_MINUTE = 60;
const MILLISECONDS_PER_SECOND = 1_000;
const DEFAULT_CAPABILITY_LIFETIME_MILLISECONDS =
  DEFAULT_CAPABILITY_LIFETIME_MINUTES * SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND;

export const MCP_ASSET_UPLOAD_ROUTE_PATH = `${MCP_ROUTE_PATH}/asset-transfers/uploads/:requestId`;
export const MCP_ASSET_DOWNLOAD_ROUTE_PATH = `${MCP_ROUTE_PATH}/asset-transfers/downloads/:requestId`;
export const MCP_ASSET_TRANSFER_CAPABILITY_HEADER = 'x-context-use-transfer-capability';

type UploadCapability = {
  kind: 'upload';
  principal: McpClientAuthorizationPrincipal;
  name: string;
  allowDuplicate: boolean | undefined;
  expiresAtMilliseconds: number;
};

type DownloadCapability = {
  kind: 'download';
  principal: McpClientAuthorizationPrincipal;
  readableId: string;
  expiresAtMilliseconds: number;
};

type AssetTransferCapability = UploadCapability | DownloadCapability;

type IssuedCapability = {
  url: string;
  secret: string;
  expiresAt: string;
};

function randomCapability(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(CAPABILITY_BYTES))).toString(
    'base64url',
  );
}

export class AssetTransferCapabilities {
  private readonly baseUrl: URL;
  private readonly capabilities = new Map<
    string,
    { secret: string; transfer: AssetTransferCapability }
  >();
  private readonly lifetimeMilliseconds: number;
  private readonly now: () => number;
  private readonly token: () => string;

  constructor({
    baseUrl,
    lifetimeMilliseconds = DEFAULT_CAPABILITY_LIFETIME_MILLISECONDS,
    now = Date.now,
    token = randomCapability,
  }: {
    baseUrl: URL;
    lifetimeMilliseconds?: number;
    now?: () => number;
    token?: () => string;
  }) {
    this.baseUrl = baseUrl;
    this.lifetimeMilliseconds = lifetimeMilliseconds;
    this.now = now;
    this.token = token;
  }

  issueUpload(input: {
    principal: McpClientAuthorizationPrincipal;
    name: string;
    allowDuplicate?: boolean;
  }): IssuedCapability {
    return this.issue({
      kind: 'upload',
      principal: input.principal,
      name: input.name,
      allowDuplicate: input.allowDuplicate,
      expiresAtMilliseconds: this.now() + this.lifetimeMilliseconds,
    });
  }

  issueDownload(input: {
    principal: McpClientAuthorizationPrincipal;
    readableId: string;
  }): IssuedCapability {
    return this.issue({
      kind: 'download',
      principal: input.principal,
      readableId: input.readableId,
      expiresAtMilliseconds: this.now() + this.lifetimeMilliseconds,
    });
  }

  consumeUpload({
    requestId,
    secret,
  }: {
    requestId: string;
    secret: string;
  }): { state: 'valid'; capability: UploadCapability } | { state: 'invalid' } {
    const consumed = this.consume({ requestId, secret, kind: 'upload' });
    return consumed.state === 'valid'
      ? { state: 'valid', capability: consumed.capability as UploadCapability }
      : consumed;
  }

  consumeDownload({
    requestId,
    secret,
  }: {
    requestId: string;
    secret: string;
  }): { state: 'valid'; capability: DownloadCapability } | { state: 'invalid' } {
    const consumed = this.consume({ requestId, secret, kind: 'download' });
    return consumed.state === 'valid'
      ? { state: 'valid', capability: consumed.capability as DownloadCapability }
      : consumed;
  }

  private issue(capability: AssetTransferCapability): IssuedCapability {
    this.pruneExpired();
    let requestId = this.token();
    while (this.capabilities.has(requestId)) {
      requestId = this.token();
    }
    const secret = this.token();
    this.capabilities.set(requestId, { secret, transfer: capability });
    const route = capability.kind === 'upload' ? 'uploads' : 'downloads';
    return {
      url: new URL(`${MCP_ROUTE_PATH}/asset-transfers/${route}/${requestId}`, this.baseUrl.origin)
        .href,
      secret,
      expiresAt: new Date(capability.expiresAtMilliseconds).toISOString(),
    };
  }

  private consume({
    requestId,
    secret,
    kind,
  }: {
    requestId: string;
    secret: string;
    kind: AssetTransferCapability['kind'];
  }): { state: 'valid'; capability: AssetTransferCapability } | { state: 'invalid' } {
    const stored = this.capabilities.get(requestId);
    if (!stored) {
      return { state: 'invalid' };
    }
    this.capabilities.delete(requestId);
    if (
      !this.matchesSecret({ expected: stored.secret, received: secret }) ||
      stored.transfer.kind !== kind ||
      stored.transfer.expiresAtMilliseconds <= this.now()
    ) {
      return { state: 'invalid' };
    }
    return { state: 'valid', capability: stored.transfer };
  }

  private pruneExpired(): void {
    const now = this.now();
    for (const [requestId, capability] of this.capabilities) {
      if (capability.transfer.expiresAtMilliseconds <= now) {
        this.capabilities.delete(requestId);
      }
    }
  }

  private matchesSecret({ expected, received }: { expected: string; received: string }): boolean {
    const expectedBytes = Buffer.from(expected);
    const receivedBytes = Buffer.from(received);
    return (
      expectedBytes.byteLength === receivedBytes.byteLength &&
      timingSafeEqual(expectedBytes, receivedBytes)
    );
  }
}

export type AssetTransferCapabilitiesContract = Pick<
  AssetTransferCapabilities,
  'issueUpload' | 'issueDownload' | 'consumeUpload' | 'consumeDownload'
>;
