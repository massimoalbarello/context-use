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
  const links = markdownLinks(tree);
  const linked = new Set<string>();
  const replacements = new Map<string, string>();
  for (const { target, embedded } of links) {
    const ref = resolveAssetReference({ value: target.url, assetRefs: input.assetRefs });
    if (!ref) {
      continue;
    }
    const key = assetKey(ref);
    const asset = input.assets.get(key);
    if (!asset) {
      throw new Error('Missing record asset');
    }
    if (!embedded) {
      linked.add(key);
    }
    replacements.set(target.url, assetAddress(asset.readableId));
  }
  // Resolve shared Markdown definitions before rewriting them: one can serve an image and a link.
  for (const { target } of links) {
    target.url = replacements.get(target.url) ?? target.url;
  }
  // Every declared asset needs a navigable link, even when it only appears as an image or in data.
  for (const ref of Object.values(input.assetRefs)) {
    const key = assetKey(ref);
    if (linked.has(key)) {
      continue;
    }
    const asset = input.assets.get(key);
    if (!asset) {
      throw new Error('Missing record asset');
    }
    linked.add(key);
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
  return linked.size ? toMarkdown(tree) : input.body;
}
