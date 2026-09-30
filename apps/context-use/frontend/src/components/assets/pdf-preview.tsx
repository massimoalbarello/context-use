import { cn } from '@repo/ui/class-names';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { AssetPreviewFallback } from './asset-preview-fallback';
import { PdfPreviewLoading } from './pdf-preview-loading';

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

function PdfPreview({
  bytes,
  name,
  className,
}: {
  bytes: Uint8Array;
  name: string;
  className?: string;
}) {
  const file = useMemo(() => ({ data: bytes.slice() }), [bytes]);
  const container = useRef<HTMLDivElement>(null);
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
      className={cn(
        'max-h-[32rem] min-w-0 overflow-auto overscroll-contain rounded-[0.75rem] bg-muted p-3',
        className,
      )}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard users need to scroll the PDF.
      tabIndex={0}
      aria-label={`${name} preview`}
    >
      <div ref={container} className="flex min-h-full flex-col">
        {failed ? (
          fallback
        ) : (
          <Document
            className="flex flex-1 flex-col"
            file={file}
            options={PDF_OPTIONS}
            suspense={false}
            error={fallback}
            loading={<PdfPreviewLoading />}
            onPassword={() => setFailed(true)}
          >
            {({ pdf }) => (
              <div className="grid gap-2">
                {width > 0 &&
                  Array.from(Array(pdf.numPages).keys()).map((pageIndex) => (
                    <Page
                      key={pageIndex + 1}
                      pageNumber={pageIndex + 1}
                      width={width}
                      suspense={false}
                      className="bg-muted! shadow-sm ring-1 ring-foreground/20"
                      aria-label={`${name}, page ${pageIndex + 1}`}
                      renderTextLayer={false}
                      renderAnnotationLayer={false}
                      error={fallback}
                      loading={<PdfPreviewLoading />}
                      onRenderError={() => setFailed(true)}
                    />
                  ))}
              </div>
            )}
          </Document>
        )}
      </div>
    </section>
  );
}
