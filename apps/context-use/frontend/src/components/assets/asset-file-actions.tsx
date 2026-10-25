import { buttonVariants } from '@repo/ui/button';
import { Download, ExternalLink } from 'lucide-react';
import { assetContentUrl, assetDownloadUrl } from '../../lib/asset-presentation';

export function AssetFileActions({
  readableId,
  includeArchived = false,
}: {
  readableId: string;
  includeArchived?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <a
        className={buttonVariants({ variant: 'outline', size: 'sm' })}
        href={assetDownloadUrl({ readableId: readableId, includeArchived: includeArchived })}
        download
      >
        <Download aria-hidden="true" />
        Download
      </a>
      <a
        className={buttonVariants({ variant: 'ghost', size: 'sm' })}
        href={assetContentUrl({ readableId: readableId, includeArchived: includeArchived })}
        target="_blank"
        rel="noreferrer"
      >
        <ExternalLink aria-hidden="true" />
        Open file
      </a>
    </div>
  );
}
