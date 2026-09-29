import { File } from 'lucide-react';
import type { ReactNode } from 'react';
export function AssetPreviewFallback({
  message,
  children,
}: {
  message: string;
  children?: ReactNode;
}) {
  return (
    <div className="grid min-h-48 content-center justify-items-center gap-3 rounded-lg bg-muted/50 p-6 text-center">
      <File className="size-10 text-muted-foreground" aria-hidden="true" />
      <p className="font-medium text-sm" role="status">
        {message}
      </p>
      {children ?? (
        <p className="text-muted-foreground text-sm">
          Download the file to open it in a compatible app.
        </p>
      )}
    </div>
  );
}
