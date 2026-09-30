import { LoaderCircle } from 'lucide-react';

export function PdfPreviewLoading() {
  return (
    <div
      role="status"
      className="flex min-h-48 flex-1 items-center justify-center gap-2 rounded-[0.75rem] bg-muted p-6 text-muted-foreground text-sm"
    >
      <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden="true" />
      <span>Loading PDF…</span>
    </div>
  );
}
