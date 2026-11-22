import Papa from 'papaparse';
import { lazy, Suspense, useMemo } from 'react';
import { AssetPreviewFallback } from './asset-preview-fallback';
import { PdfPreviewLoading } from './pdf-preview-loading';

const MAX_TEXT_CHARACTERS = 50_000;
const MAX_TABLE_ROWS = 100;
const MAX_TABLE_COLUMNS = 20;
export function AssetDocument({
  mediaType,
  name,
  bytes,
  pdfOrigin = '',
}: {
  mediaType: string;
  name: string;
  bytes: Uint8Array<ArrayBuffer>;
  pdfOrigin?: string;
}) {
  const PdfPreview = useMemo(
    () =>
      lazy(async () => {
        const { createPdfPreview } = await import('./pdf-preview');
        return { default: createPdfPreview(pdfOrigin) };
      }),
    [pdfOrigin],
  );
  if (mediaType === 'application/pdf') {
    return (
      <div className="flex max-h-[32rem] min-w-0 flex-col">
        <Suspense fallback={<PdfPreviewLoading />}>
          <PdfPreview bytes={bytes} name={name} />
        </Suspense>
      </div>
    );
  }
  const text = new TextDecoder().decode(bytes);
  if (mediaType === 'text/csv') {
    return <CsvPreview text={text} name={name} />;
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
