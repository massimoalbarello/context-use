import { fromMarkdown } from 'mdast-util-from-markdown';
import { markdownLinks } from '#backend/models/markdown/links.ts';
import { ASSET_ADDRESS_PREFIX, assetReadableId } from '#backend/models/readable-ids/addresses.ts';
import { isReadableId } from '#backend/models/readable-ids/model.ts';

export class InvalidRecordAssetError extends Error {
  constructor() {
    super('Record asset references must identify available assets owned by this user.');
  }
}

export type RecordAssetUsage = { readableId: string; presentation: 'embed' | 'attachment' };

export function recordAssetUsages(body: string): RecordAssetUsage[] {
  const usages = new Map<string, RecordAssetUsage>();
  for (const { target, embedded } of markdownLinks(fromMarkdown(body))) {
    if (!target.url.startsWith(ASSET_ADDRESS_PREFIX)) {
      continue;
    }
    const readableId = assetReadableId(target.url);
    if (!isReadableId(readableId)) {
      throw new InvalidRecordAssetError();
    }
    const presentation = embedded ? 'embed' : 'attachment';
    usages.set(`${readableId}:${presentation}`, { readableId, presentation });
  }
  return [...usages.values()];
}
