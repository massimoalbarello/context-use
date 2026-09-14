import { File } from 'lucide-react';
export function AssetPreviewFallback({ message }: { message: string }) {
  return (
    <div className="grid min-h-48 content-center justify-items-center gap-3 rounded-lg bg-muted/50 p-6 text-center">
      <File className="size-10 text-muted-foreground" aria-hidden="true" />
      <p className="font-medium text-sm" role="status">
        {message}
      </p>
      <p className="text-muted-foreground text-sm">
        Download the file to open it in a compatible app.
      </p>
    </div>
  );
}
