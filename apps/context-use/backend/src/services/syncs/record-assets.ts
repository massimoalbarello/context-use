import { type AssetRef, assetKey, resolveAssetReference } from '@context-use/open-sync/assets';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { toMarkdown } from 'mdast-util-to-markdown';
import { markdownLinks } from '#backend/models/markdown/links.ts';
import { assetAddress } from '#backend/models/readable-ids/addresses.ts';

export function importedAssetReadableId(input: {
  ownerId: string;
  syncId: string;
  asset: AssetRef;
}) {
  const identity = JSON.stringify([
    input.ownerId,
    input.syncId,
    input.asset.id,
    input.asset.version,
  ]);
  return `sync-asset-${new Bun.CryptoHasher('sha256').update(identity).digest('hex')}`;
}

export function mapRecordAssets(input: {
  body: string;
  assetRefs: Readonly<Record<string, AssetRef>>;
  assets: ReadonlyMap<string, { readableId: string; name: string }>;
}): string {
  const tree = fromMarkdown(input.body);
  const used = new Set<string>();
  for (const { target } of markdownLinks(tree)) {
    const ref = resolveAssetReference({ value: target.url, assetRefs: input.assetRefs });
    if (!ref) {
      continue;
    }
    const key = assetKey(ref);
    const asset = input.assets.get(key);
    if (!asset) {
      throw new Error('Missing record asset');
    }
    used.add(key);
    target.url = assetAddress(asset.readableId);
  }
  // A reference may exist only in opaque source data. Preserve it as a readable attachment.
  for (const ref of Object.values(input.assetRefs)) {
    const key = assetKey(ref);
    if (used.has(key)) {
      continue;
    }
    const asset = input.assets.get(key);
    if (!asset) {
      throw new Error('Missing record asset');
    }
    used.add(key);
    tree.children.push({
      type: 'paragraph',
      children: [
        {
          type: 'link',
          url: assetAddress(asset.readableId),
          children: [{ type: 'text', value: asset.name }],
        },
      ],
    });
  }
  return used.size ? toMarkdown(tree) : input.body;
}
