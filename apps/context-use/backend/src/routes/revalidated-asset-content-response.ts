import { StatusMap } from 'elysia';
import fresh from 'fresh';
import type { StoredAsset } from '#backend/models/assets/model.ts';
import { assetContentResponse } from '#backend/routes/asset-content-response.ts';

/** Call only after checking access to the current asset and availability of its stored file. */
export function revalidatedAssetContentResponse({
  asset,
  blob,
  inline,
  request,
  cacheKey,
  vary,
}: {
  asset: Pick<StoredAsset, 'contentHash' | 'name' | 'mediaType' | 'extension' | 'sizeBytes'>;
  blob: Blob;
  inline: boolean;
  request: Request;
  cacheKey: string;
  vary?: string;
}): Response {
  const version = new Bun.CryptoHasher('sha256')
    .update(
      JSON.stringify([
        cacheKey,
        asset.contentHash,
        asset.name,
        asset.mediaType,
        asset.extension,
        inline,
      ]),
    )
    .digest('hex');
  const etag = `"${version}"`;
  const cacheHeaders = new Headers({
    etag,
    'cache-control': 'private, no-cache',
  });
  if (vary) {
    cacheHeaders.set('vary', vary);
  }
  if (fresh(Object.fromEntries(request.headers), { etag })) {
    return new Response(null, { status: StatusMap['Not Modified'], headers: cacheHeaders });
  }
  const response = assetContentResponse({
    asset,
    blob,
    inline,
    request,
    etag,
  });
  // Failed range requests should not replace a cached representation.
  if (response.ok) {
    for (const [name, value] of cacheHeaders) {
      response.headers.set(name, value);
    }
  }
  return response;
}
