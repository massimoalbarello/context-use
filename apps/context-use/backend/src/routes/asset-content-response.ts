import { StatusMap } from 'elysia';
import rangeParser from 'range-parser';
import type { StoredAsset } from '#backend/models/assets/model.ts';

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
  request,
}: {
  asset: Pick<StoredAsset, 'name' | 'extension' | 'mediaType' | 'sizeBytes'>;
  blob: Blob;
  inline: boolean;
  request?: Request;
}): Response {
  const headers = new Headers({
    'content-type': asset.mediaType,
    'content-length': String(asset.sizeBytes),
    'content-disposition': contentDisposition({
      name: asset.name,
      extension: asset.extension,
      inline,
    }),
    'x-content-type-options': 'nosniff',
    'cache-control': 'private, no-store',
  });
  if (request) {
    headers.set('accept-ranges', 'bytes');
  }
  let body = blob;
  let status: number = StatusMap.OK;
  const range = request?.headers.has('if-range') ? null : request?.headers.get('range');
  if (range?.startsWith('bytes=')) {
    // range-parser treats an oversized suffix as unsatisfiable; HTTP requires the whole file.
    const normalizedRange =
      /^bytes=-\d+$/.test(range) && Number(range.slice('bytes=-'.length)) > asset.sizeBytes
        ? 'bytes=0-'
        : range;
    const ranges = rangeParser(asset.sizeBytes, normalizedRange);
    if (ranges === -1) {
      headers.set('content-range', `bytes */${asset.sizeBytes}`);
      headers.set('content-length', '0');
      return new Response(null, { status: StatusMap['Range Not Satisfiable'], headers });
    }
    // Ignore malformed, unsupported and multipart ranges, which permits a full response.
    if (typeof ranges !== 'number' && ranges.length === 1) {
      const { start, end } = ranges[0]!;
      headers.set('content-range', `bytes ${start}-${end}/${asset.sizeBytes}`);
      headers.set('content-length', String(end - start + 1));
      body = blob.slice(start, end + 1);
      status = StatusMap['Partial Content'];
    }
  }
  // Hide Bun's native file stream marker: its sendfile shortcut reapplies Range,
  // even when If-Range requires a full response. The transform retains backpressure.
  return new Response(body.stream().pipeThrough(new TransformStream()), { status, headers });
}
