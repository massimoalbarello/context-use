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
    <section
      ref={container}
      className="max-h-[32rem] min-w-0 overflow-auto overscroll-contain"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard users need to scroll the PDF.
      tabIndex={0}
      aria-label={`${name} preview`}
    >
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
              {width > 0 &&
                Array.from(Array(pdf.numPages).keys()).map((pageIndex) => (
                  <Page
                    key={pageIndex + 1}
                    pageNumber={pageIndex + 1}
                    width={width}
                    suspense={false}
                    className="overflow-hidden rounded-lg"
                    aria-label={`${name}, page ${pageIndex + 1}`}
                    renderTextLayer={false}
                    renderAnnotationLayer={false}
                    error={fallback}
                    loading={<p role="status">Loading page…</p>}
                    onRenderError={() => setFailed(true)}
                  />
                ))}
            </div>
          )}
        </Document>
      )}
    </section>
  );
}
