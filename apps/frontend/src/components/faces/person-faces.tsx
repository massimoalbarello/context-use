import { useInfiniteQuery } from '@tanstack/react-query';
import { personImagesQueryOptions } from '../../queries/faces';
import { AssetLink } from '../assets/asset-link';
import { ResourceList } from '../knowledge/resource-list';
import { Button } from '../ui/button';
import { FieldError } from '../ui/field';

export function PersonImages({ readableId }: { readableId: string }) {
  const images = useInfiniteQuery(personImagesQueryOptions(readableId));
  const items = images.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <section className="grid gap-4 pt-2" aria-label="Appears in">
      <h2 className="font-semibold text-lg">Appears in</h2>
      {images.error && <FieldError>{images.error.message}</FieldError>}
      {images.isPending && <p className="text-muted-foreground text-sm">Loading images…</p>}
      {!images.isPending && !images.error && items.length === 0 && (
        <p className="text-muted-foreground text-sm">None yet.</p>
      )}
      {items.length > 0 && (
        <ResourceList>
          {items.map((asset) => (
            <li key={asset.readableId}>
              <AssetLink asset={asset} presentation="card" />
            </li>
          ))}
        </ResourceList>
      )}
      {images.hasNextPage && (
        <div>
          <Button
            variant="outline"
            disabled={images.isFetchingNextPage}
            onClick={() => void images.fetchNextPage()}
          >
            More images
          </Button>
        </div>
      )}
    </section>
  );
}
