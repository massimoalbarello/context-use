import { useQuery } from '@tanstack/react-query';
import Papa from 'papaparse';
import { lazy, Suspense, useState } from 'react';
import { assetContentUrl, isEmbeddableAsset, isVideoAsset } from '../../lib/asset-presentation';
import { assetDocumentQueryOptions, MAX_DOCUMENT_PREVIEW_BYTES } from '../../queries/assets';
import { AssetPreviewFallback } from './asset-preview-fallback';

const MAX_TEXT_CHARACTERS = 50_000;
const MAX_TABLE_ROWS = 100;
const MAX_TABLE_COLUMNS = 20;

const PdfPreview = lazy(() => import('./pdf-preview'));

type PreviewableAsset = {
  readableId: string;
  name: string;
  mediaType: string;
  sizeBytes?: number;
};

export function AssetMedia(props: { asset: PreviewableAsset; className: string }) {
  return <AssetMediaContent key={props.asset.readableId} {...props} />;
}

function AssetMediaContent({ asset, className }: { asset: PreviewableAsset; className: string }) {
  const [failed, setFailed] = useState(false);
  const contentUrl = assetContentUrl(asset.readableId);
  if (failed) {
    return <AssetPreviewFallback message="This file could not be previewed." />;
  }
  if (isEmbeddableAsset(asset)) {
    return (
      <img
        className={className}
        src={contentUrl}
        alt={asset.name}
        onError={() => setFailed(true)}
      />
    );
  }
  if (isVideoAsset(asset)) {
    return (
      // biome-ignore lint/a11y/useMediaCaption: uploaded videos do not have a paired caption asset.
      <video
        className={className}
        src={contentUrl}
        aria-label={asset.name}
        controls
        playsInline
        preload="metadata"
        onError={() => setFailed(true)}
      />
    );
  }
  if (
    ['audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/flac'].includes(
      asset.mediaType,
    )
  ) {
    return (
      // biome-ignore lint/a11y/useMediaCaption: uploaded audio has no paired transcript asset.
      <audio
        className="w-full"
        src={contentUrl}
        aria-label={asset.name}
        controls
        preload="metadata"
        onError={() => setFailed(true)}
      />
    );
  }
  if (
    asset.mediaType.startsWith('text/') ||
    asset.mediaType === 'application/json' ||
    asset.mediaType === 'application/pdf'
  ) {
    if ((asset.sizeBytes ?? 0) > MAX_DOCUMENT_PREVIEW_BYTES) {
      return <AssetPreviewFallback message="This file is too large to preview." />;
    }
    return <DocumentPreview asset={asset} />;
  }
  return <AssetPreviewFallback message="Preview isn’t available for this file format." />;
}

function DocumentPreview({ asset }: { asset: PreviewableAsset }) {
  const content = useQuery(assetDocumentQueryOptions(asset.readableId));
  if (content.error) {
    return <AssetPreviewFallback message={content.error.message} />;
  }
  if (!content.data) {
    return <p role="status">Loading preview…</p>;
  }
  if (asset.mediaType === 'application/pdf') {
    return (
      <Suspense fallback={<p role="status">Loading PDF…</p>}>
        <PdfPreview bytes={content.data} name={asset.name} />
      </Suspense>
    );
  }
  const text = new TextDecoder().decode(content.data);
  if (asset.mediaType === 'text/csv') {
    return <CsvPreview text={text} name={asset.name} />;
  }
  const preview = text.slice(0, MAX_TEXT_CHARACTERS);
  return (
    <div className="min-w-0">
      <pre
        // biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard users need to scroll the document.
        tabIndex={0}
        className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/50 p-5 font-mono text-xs leading-relaxed"
      >
        {preview}
      </pre>
      {preview.length < text.length && (
        <p className="mt-2 text-muted-foreground text-xs">
          Showing the first 50,000 characters. Download for the full document.
        </p>
      )}
    </div>
  );
}

function CsvPreview({ text, name }: { text: string; name: string }) {
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: true, preview: MAX_TABLE_ROWS + 1 });
  const [header, ...rows] = parsed.data;
  if (!header || parsed.errors.length) {
    return <AssetPreviewFallback message="This table could not be previewed." />;
  }
  return (
    <div className="min-w-0">
      <section
        className="max-h-[32rem] overflow-auto rounded-lg border"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard users need to scroll the table.
        tabIndex={0}
        aria-label={`${name} table`}
      >
        <table className="w-full text-left text-xs">
          <caption className="sr-only">{name}</caption>
          <thead className="sticky top-0 bg-muted">
            <tr>
              {Array.from(header.slice(0, MAX_TABLE_COLUMNS).entries()).map(([index, cell]) => (
                <th key={index} scope="col" className="min-w-32 border-b px-3 py-3 font-semibold">
                  {cell.replaceAll('_', ' ')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from(rows.entries()).map(([index, row]) => (
              <tr key={index} className="border-b last:border-0">
                {Array.from(row.slice(0, MAX_TABLE_COLUMNS).entries()).map(([column, cell]) => (
                  <td key={column} className="max-w-64 break-words px-3 py-3 align-top">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {(parsed.meta.truncated || header.length > MAX_TABLE_COLUMNS) && (
        <p className="mt-2 text-muted-foreground text-xs">
          Preview limited to 100 rows and 20 columns. Download for the full table.
        </p>
      )}
    </div>
  );
}
