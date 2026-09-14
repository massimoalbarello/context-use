import { Button } from '@repo/ui/button';
import { getDocument, type PDFDocumentProxy, PDFWorker, type RenderTask } from 'pdfjs-dist';
import { useEffect, useRef, useState } from 'react';
import { AssetPreviewFallback } from './asset-preview-fallback';

export default function PdfPreview({ bytes, name }: { bytes: Uint8Array; name: string }) {
  const [document, setDocument] = useState<PDFDocumentProxy>();
  const [failed, setFailed] = useState(false);
  const [page, setPage] = useState(1);
  useEffect(() => {
    const port = new Worker(new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url), {
      type: 'module',
    });
    const worker = PDFWorker.create({ port });
    const task = getDocument({
      data: bytes.slice(),
      worker,
      cMapUrl: '/pdfjs/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: '/pdfjs/standard_fonts/',
      wasmUrl: '/pdfjs/wasm/',
    });
    task.onPassword = () => {
      setFailed(true);
      void task.destroy();
    };
    let active = true;
    void task.promise
      .then((pdf) => {
        if (active) {
          setDocument(pdf);
        }
      })
      .catch(() => {
        if (active) {
          setFailed(true);
        }
      });
    return () => {
      active = false;
      void task.destroy().finally(() => {
        worker.destroy();
        port.terminate();
      });
    };
  }, [bytes]);
  if (failed) {
    return (
      <AssetPreviewFallback message="This PDF could not be previewed. It may be damaged or password protected." />
    );
  }
  if (!document) {
    return <p role="status">Loading PDF…</p>;
  }
  return (
    <div className="grid min-w-0 gap-3">
      <PdfPage
        key={page}
        document={document}
        page={page}
        name={name}
        onError={() => setFailed(true)}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>
          Previous page
        </Button>
        <p className="text-muted-foreground text-xs" role="status">
          Page {page} of {document.numPages}
        </p>
        <Button
          variant="outline"
          size="sm"
          disabled={page === document.numPages}
          onClick={() => setPage(page + 1)}
        >
          Next page
        </Button>
      </div>
    </div>
  );
}

function PdfPage({
  document,
  page,
  name,
  onError,
}: {
  document: PDFDocumentProxy;
  page: number;
  name: string;
  onError: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  useEffect(() => {
    const element = canvas.current!;
    const parent = container.current!;
    let active = true;
    let rendering = Promise.resolve();
    let renderTask: RenderTask | undefined;
    let lastWidth = 0;
    const observer = new ResizeObserver(() => {
      const width = parent.clientWidth;
      if (width === lastWidth) {
        return;
      }
      lastWidth = width;
      rendering = rendering
        .then(async () => {
          if (!active || !width) {
            return;
          }
          const pdfPage = await document.getPage(page);
          if (!active) {
            return;
          }
          const viewport = pdfPage.getViewport({
            scale:
              (width / pdfPage.getViewport({ scale: 1 }).width) *
              Math.min(window.devicePixelRatio, 2),
          });
          element.width = Math.ceil(viewport.width);
          element.height = Math.ceil(viewport.height);
          renderTask = pdfPage.render({ canvas: element, viewport });
          await renderTask.promise;
        })
        .catch(() => {
          if (active) {
            onErrorRef.current();
          }
        });
    });
    observer.observe(parent);
    return () => {
      active = false;
      observer.disconnect();
      renderTask?.cancel();
    };
  }, [document, page]);
  return (
    <div ref={container} className="min-w-0 overflow-hidden rounded-lg border bg-white">
      <canvas
        ref={canvas}
        role="img"
        aria-label={`${name}, page ${page}`}
        className="block h-auto w-full"
      />
    </div>
  );
}
