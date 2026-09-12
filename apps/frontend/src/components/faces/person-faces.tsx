import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useAnalyzeAsset, useSelectFaceReference } from '../../lib/hooks/use-faces';
import {
  faceCropUrl,
  personImagesQueryOptions,
  personReferenceQueryOptions,
} from '../../queries/faces';
import { AssetLink } from '../assets/asset-link';
import { AssetMedia } from '../assets/asset-media';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { FieldError } from '../ui/field';

export function PersonFaceReference({ readableId }: { readableId: string }) {
  const reference = useQuery(personReferenceQueryOptions(readableId));
  const select = useSelectFaceReference();
  const analyze = useAnalyzeAsset();
  const data = reference.data;
  const processing = analyze.isPending || data?.analysis?.state === 'processing';
  return (
    <section className="grid gap-3" aria-label="Recognition reference">
      <h2 className="font-semibold text-lg">Recognition reference</h2>
      {reference.error && <FieldError>{reference.error.message}</FieldError>}
      {reference.isPending && <p className="text-muted-foreground text-sm">Loading reference…</p>}
      {data && !data.image && (
        <p className="text-muted-foreground text-sm">
          Assign an image to this person to find them in your photos.
        </p>
      )}
      {data?.image && (
        <>
          <p className="text-muted-foreground text-sm">
            {data.referenceFaceReadableId
              ? 'This face is used to recognize this person in uploaded images.'
              : data.analysis?.faces.length
                ? 'Choose this person’s face in their image. Existing unknown faces will be checked too.'
                : 'No reference face is ready. Analyze the image or choose a clearer portrait.'}
          </p>
          <div className="flex flex-wrap gap-3">
            {data.analysis?.faces
              .filter((face) => face.decision !== 'dismissed')
              .map((face) => (
                <button
                  type="button"
                  key={face.readableId}
                  disabled={select.isPending || face.needsReview}
                  aria-label={
                    data.referenceFaceReadableId === face.readableId
                      ? 'Selected reference face'
                      : 'Use this face as reference'
                  }
                  aria-pressed={data.referenceFaceReadableId === face.readableId}
                  className="grid w-24 gap-2 rounded-lg border border-transparent p-2 text-center outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring aria-pressed:border-foreground/40 aria-pressed:bg-muted"
                  onClick={() =>
                    select.mutate({ entityReadableId: readableId, faceReadableId: face.readableId })
                  }
                >
                  <img
                    src={faceCropUrl({
                      assetReadableId: data.image!.readableId,
                      faceReadableId: face.readableId,
                    })}
                    alt="Reference face"
                    className="aspect-square w-full rounded-lg object-cover"
                  />
                  {data.referenceFaceReadableId === face.readableId ? (
                    <Badge variant="secondary">Reference</Badge>
                  ) : (
                    <span className="text-xs">Use this face</span>
                  )}
                </button>
              ))}
          </div>
          {(data.analysis?.state !== 'ready' || data.analysis.outdated) &&
            data.analysis?.state !== 'unsupported' && (
              <div>
                <Button
                  variant="outline"
                  disabled={processing}
                  onClick={() => analyze.mutate(data.image!.readableId)}
                >
                  {processing ? 'Analyzing…' : 'Analyze reference image'}
                </Button>
              </div>
            )}
          {data.analysis?.error && (
            <p role="status" className="text-muted-foreground text-sm">
              {data.analysis.error}
            </p>
          )}
        </>
      )}
      {(select.error || analyze.error) && (
        <FieldError>{(select.error ?? analyze.error)?.message}</FieldError>
      )}
    </section>
  );
}

export function PersonImages({ readableId }: { readableId: string }) {
  const images = useInfiniteQuery(personImagesQueryOptions(readableId));
  const items = images.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <section className="grid gap-4" aria-label="Appears in">
      <h2 className="font-semibold text-lg">Appears in</h2>
      {images.error && <FieldError>{images.error.message}</FieldError>}
      {images.isPending && <p className="text-muted-foreground text-sm">Loading images…</p>}
      {!images.isPending && !images.error && items.length === 0 && (
        <p className="text-muted-foreground text-sm">
          No images yet. Matching photos will appear here.
        </p>
      )}
      <ul className="grid list-none gap-4 p-0 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((asset) => (
          <li key={asset.readableId} className="overflow-hidden rounded-xl bg-muted">
            <AssetMedia asset={asset} className="aspect-[4/3] w-full object-cover" />
            <AssetLink asset={asset} presentation="card" />
          </li>
        ))}
      </ul>
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
