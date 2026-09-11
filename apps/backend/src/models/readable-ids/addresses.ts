export const ASSET_ADDRESS_PREFIX = 'context-use://asset/';
export const ENTITY_ADDRESS_PREFIX = 'context-use://entity/';
export const PAGE_ADDRESS_PREFIX = 'context-use://page/';
export const RECORD_ADDRESS_PREFIX = 'context-use://record/';

export function assetAddress(readableId: string): string {
  return `${ASSET_ADDRESS_PREFIX}${readableId}`;
}

export function entityAddress(readableId: string): string {
  return `${ENTITY_ADDRESS_PREFIX}${readableId}`;
}

export function pageAddress(readableId: string): string {
  return `${PAGE_ADDRESS_PREFIX}${readableId}`;
}

export function recordAddress(readableId: string): string {
  return `${RECORD_ADDRESS_PREFIX}${readableId}`;
}

export function recordReadableId(address: string): string {
  return address.slice(RECORD_ADDRESS_PREFIX.length);
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
