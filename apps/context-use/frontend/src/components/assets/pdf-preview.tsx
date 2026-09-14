import { Button } from '@repo/ui/button';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { AssetPreviewFallback } from './asset-preview-fallback';

const PDF_OPTIONS = {
  cMapUrl: '/pdfjs/cmaps/',
  cMapPacked: true,
  standardFontDataUrl: '/pdfjs/standard_fonts/',
  wasmUrl: '/pdfjs/wasm/',
};

export function createPdfPreview() {
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
  return PdfPreview;
}

function PdfPreview({ bytes, name }: { bytes: Uint8Array; name: string }) {
  const file = useMemo(() => ({ data: bytes }), [bytes]);
  const container = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(0);
  const [page, setPage] = useState(1);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const element = container.current!;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const fallback = (
    <AssetPreviewFallback message="This PDF could not be previewed. It may be damaged or password protected." />
  );
  return (
    <section ref={container} className="min-w-0" aria-label={`${name} preview`}>
      {failed ? (
        fallback
      ) : (
        <Document
          file={file}
          options={PDF_OPTIONS}
          suspense={false}
          error={fallback}
          loading={<p role="status">Loading PDF…</p>}
          onPassword={() => setFailed(true)}
        >
          {({ pdf }) => (
            <div className="grid gap-3">
              {width > 0 && (
                <Page
                  pageNumber={page}
                  width={width}
                  suspense={false}
                  className="overflow-hidden rounded-lg border"
                  aria-label={`${name}, page ${page}`}
                  renderTextLayer={false}
                  renderAnnotationLayer={false}
                  error={fallback}
                  loading={<p role="status">Loading page…</p>}
                  onRenderError={() => setFailed(true)}
                />
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 1}
                  onClick={() => setPage(page - 1)}
                >
                  Previous page
                </Button>
                <p className="text-muted-foreground text-xs" role="status">
                  Page {page} of {pdf.numPages}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === pdf.numPages}
                  onClick={() => setPage(page + 1)}
                >
                  Next page
                </Button>
              </div>
            </div>
          )}
        </Document>
      )}
    </section>
  );
}
