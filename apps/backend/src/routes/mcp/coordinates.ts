import { z } from 'zod';
import { MAX_READABLE_ID_LENGTH, READABLE_ID_PATTERN } from '#models/readable-ids/model.ts';

const ENTITY_ADDRESS_PREFIX = 'context-use://entity/';
const PAGE_ADDRESS_PREFIX = 'context-use://page/';

function addressSchema(prefix: string) {
  return z
    .string()
    .max(prefix.length + MAX_READABLE_ID_LENGTH)
    .refine((address) => {
      if (!address.startsWith(prefix)) {
        return false;
      }
      return READABLE_ID_PATTERN.test(address.slice(prefix.length));
    });
}

export const EntityAddressSchema = addressSchema(ENTITY_ADDRESS_PREFIX).describe(
  'Canonical entity address, for example context-use://entity/luca-bianchi',
);
export const PageAddressSchema = addressSchema(PAGE_ADDRESS_PREFIX).describe(
  'Canonical knowledge-page address, for example context-use://page/growth-playbook',
);

export function entityAddress(readableId: string): string {
  return `${ENTITY_ADDRESS_PREFIX}${readableId}`;
}

export function pageAddress(readableId: string): string {
  return `${PAGE_ADDRESS_PREFIX}${readableId}`;
}

export function entityReadableId(address: string): string {
  return address.slice(ENTITY_ADDRESS_PREFIX.length);
}

export function pageReadableId(address: string): string {
  return address.slice(PAGE_ADDRESS_PREFIX.length);
}
