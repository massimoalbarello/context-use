import { StatusMap } from 'elysia';
import fresh from 'fresh';
import type { StoredAsset } from '#backend/models/assets/model.ts';
import { assetContentResponse } from '#backend/routes/asset-content-response.ts';

/** Called only after resolving the current actor's available asset and stored file. */
export function privateAssetContentResponse({
  asset,
  blob,
  inline,
  request,
}: {
  asset: Pick<
    StoredAsset,
    'ownerId' | 'id' | 'contentHash' | 'name' | 'mediaType' | 'extension' | 'sizeBytes'
  >;
  blob: Blob;
  inline: boolean;
  request: Request;
}): Response {
  const version = new Bun.CryptoHasher('sha256')
    .update(
      JSON.stringify([
        asset.ownerId,
        asset.id,
        asset.contentHash,
        asset.name,
        asset.mediaType,
        asset.extension,
        inline,
      ]),
    )
    .digest('hex');
  const etag = `"${version}"`;
  const cacheHeaders = {
    etag,
    'cache-control': 'private, no-cache',
    vary: 'Cookie, Authorization',
  };
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
    for (const [name, value] of Object.entries(cacheHeaders)) {
      response.headers.set(name, value);
    }
  }
  return response;
}
