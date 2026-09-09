import { z } from 'zod';
import { MAX_READABLE_ID_LENGTH, READABLE_ID_PATTERN } from '#models/readable-ids/model.ts';
import type { ExternalRecordIdentity } from '#models/records/model.ts';

const ASSET_ADDRESS_PREFIX = 'context-use://asset/';
const ENTITY_ADDRESS_PREFIX = 'context-use://entity/';
const EXTERNAL_RECORD_ADDRESS_PREFIX = 'context-use://external-record/';
const PAGE_ADDRESS_PREFIX = 'context-use://page/';
const READABLE_ID_PATTERN_BODY = READABLE_ID_PATTERN.source.slice(1, -1);
const BYTES_PER_KIBIBYTE = 1024;
const MAX_EXTERNAL_RECORD_ADDRESS_KIBIBYTES = 32;
const MAX_EXTERNAL_RECORD_ADDRESS_LENGTH =
  MAX_EXTERNAL_RECORD_ADDRESS_KIBIBYTES * BYTES_PER_KIBIBYTE;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const EXTERNAL_RECORD_ADDRESS_VERSION = 1;
const EXTERNAL_RECORD_ADDRESS_COMPONENTS = 5;

export const McpReadableIdSchema = z
  .string()
  .min(1)
  .max(MAX_READABLE_ID_LENGTH)
  .regex(READABLE_ID_PATTERN);

function addressSchema(prefix: string) {
  return z
    .string()
    .min(prefix.length + 1)
    .max(prefix.length + MAX_READABLE_ID_LENGTH)
    .regex(new RegExp(`^${prefix}${READABLE_ID_PATTERN_BODY}$`));
}

export const AssetAddressSchema = addressSchema(ASSET_ADDRESS_PREFIX).describe(
  'Canonical asset address, for example context-use://asset/quarterly-chart',
);
export const EntityAddressSchema = addressSchema(ENTITY_ADDRESS_PREFIX).describe(
  'Canonical entity address, for example context-use://entity/luca-bianchi',
);
export const ExternalRecordAddressSchema = z
  .string()
  .min(EXTERNAL_RECORD_ADDRESS_PREFIX.length + 1)
  .max(MAX_EXTERNAL_RECORD_ADDRESS_LENGTH)
  .refine((address) => parseExternalRecordAddress(address) !== null)
  .describe('Canonical address of one provider-neutral external record');
export const PageAddressSchema = addressSchema(PAGE_ADDRESS_PREFIX).describe(
  'Canonical knowledge-page address, for example context-use://page/growth-playbook',
);
export const PageReferenceAddressSchema = z
  .string()
  .min(PAGE_ADDRESS_PREFIX.length + 1)
  .max(PAGE_ADDRESS_PREFIX.length + MAX_READABLE_ID_LENGTH * 2 + 1)
  .regex(
    new RegExp(
      `^${PAGE_ADDRESS_PREFIX}${READABLE_ID_PATTERN_BODY}(?:#${READABLE_ID_PATTERN_BODY})?$`,
    ),
  )
  .describe(
    'Canonical knowledge-page address with an optional fragment, for example context-use://page/growth-playbook#priorities',
  );

export function assetAddress(readableId: string): string {
  return `${ASSET_ADDRESS_PREFIX}${readableId}`;
}

export function entityAddress(readableId: string): string {
  return `${ENTITY_ADDRESS_PREFIX}${readableId}`;
}

export function externalRecordAddress(identity: ExternalRecordIdentity): string {
  const encodedIdentity = Buffer.from(
    JSON.stringify([
      EXTERNAL_RECORD_ADDRESS_VERSION,
      identity.syncReadableId,
      identity.sourceId,
      identity.kind,
      identity.recordId,
    ]),
    'utf8',
  ).toString('base64url');
  return `${EXTERNAL_RECORD_ADDRESS_PREFIX}${encodedIdentity}`;
}

export function pageAddress(readableId: string): string {
  return `${PAGE_ADDRESS_PREFIX}${readableId}`;
}

export function assetReadableId(address: string): string {
  return address.slice(ASSET_ADDRESS_PREFIX.length);
}

export function entityReadableId(address: string): string {
  return address.slice(ENTITY_ADDRESS_PREFIX.length);
}

export function externalRecordIdentity(address: string): ExternalRecordIdentity {
  const identity = parseExternalRecordAddress(address);
  if (!identity) {
    throw new Error('Invalid external-record address');
  }
  return identity;
}

export function pageReadableId(address: string): string {
  return address.slice(PAGE_ADDRESS_PREFIX.length);
}

function parseExternalRecordAddress(address: string): ExternalRecordIdentity | null {
  if (
    address.length > MAX_EXTERNAL_RECORD_ADDRESS_LENGTH ||
    !address.startsWith(EXTERNAL_RECORD_ADDRESS_PREFIX)
  ) {
    return null;
  }
  const encodedIdentity = address.slice(EXTERNAL_RECORD_ADDRESS_PREFIX.length);
  if (!BASE64URL_PATTERN.test(encodedIdentity)) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.from(encodedIdentity, 'base64url').toString('utf8'));
    if (
      !Array.isArray(parsed) ||
      parsed.length !== EXTERNAL_RECORD_ADDRESS_COMPONENTS ||
      parsed[0] !== EXTERNAL_RECORD_ADDRESS_VERSION ||
      parsed.slice(1).some((value) => typeof value !== 'string' || !/\S/u.test(value))
    ) {
      return null;
    }
    const [, syncReadableId, sourceId, kind, recordId] = parsed as [
      number,
      string,
      string,
      string,
      string,
    ];
    const identity = { syncReadableId, sourceId, kind, recordId };
    return externalRecordAddress(identity) === address ? identity : null;
  } catch {
    return null;
  }
}
