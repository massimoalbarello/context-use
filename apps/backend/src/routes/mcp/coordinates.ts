import { z } from 'zod';
import {
  ASSET_ADDRESS_PREFIX,
  ENTITY_ADDRESS_PREFIX,
  PAGE_ADDRESS_PREFIX,
  RECORD_ADDRESS_PREFIX,
} from '#models/readable-ids/addresses.ts';
import { MAX_READABLE_ID_LENGTH, READABLE_ID_PATTERN } from '#models/readable-ids/model.ts';

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
export const RecordAddressSchema = addressSchema(RECORD_ADDRESS_PREFIX).describe(
  'Canonical imported-record address, for example context-use://record/meeting-notes',
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
