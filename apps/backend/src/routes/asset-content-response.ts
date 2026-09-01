import type { StoredAsset } from '#models/assets/model.ts';

function contentDisposition({
  name,
  extension,
  inline,
}: {
  name: string;
  extension: string | null;
  inline: boolean;
}): string {
  const filename = `${name}${extension ? `.${extension}` : ''}`;
  const fallback = filename.replace(/[^a-zA-Z0-9._-]/g, '_') || 'asset';
  return `${inline ? 'inline' : 'attachment'}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export function assetContentResponse({
  asset,
  blob,
  inline,
}: {
  asset: StoredAsset;
  blob: Blob;
  inline: boolean;
}): Response {
  return new Response(blob, {
    headers: {
      'content-type': asset.mediaType,
      'content-length': String(asset.sizeBytes),
      'content-disposition': contentDisposition({
        name: asset.name,
        extension: asset.extension,
        inline,
      }),
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, no-store',
    },
  });
}
