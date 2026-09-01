import { z } from 'zod';
import { MAX_READABLE_ID_LENGTH, READABLE_ID_PATTERN } from '#models/readable-ids/model.ts';

const ASSET_ADDRESS_PREFIX = 'context-use://asset/';
const ENTITY_ADDRESS_PREFIX = 'context-use://entity/';
const PAGE_ADDRESS_PREFIX = 'context-use://page/';
const READABLE_ID_PATTERN_BODY = READABLE_ID_PATTERN.source.slice(1, -1);

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

export function pageAddress(readableId: string): string {
  return `${PAGE_ADDRESS_PREFIX}${readableId}`;
}

export function assetReadableId(address: string): string {
  return address.slice(ASSET_ADDRESS_PREFIX.length);
}

export function entityReadableId(address: string): string {
  return address.slice(ENTITY_ADDRESS_PREFIX.length);
}

export function pageReadableId(address: string): string {
  return address.slice(PAGE_ADDRESS_PREFIX.length);
}
