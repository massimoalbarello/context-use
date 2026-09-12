import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { assetContentUrl } from '../../lib/asset-presentation';
import { useAnalyzeAsset, useAnnotateFace } from '../../lib/hooks/use-faces';
import type { AssetSummary } from '../../queries/assets';
import {
  type AssetFaces as AssetFacesData,
  assetFacesQueryOptions,
  type Face,
  faceCropUrl,
} from '../../queries/faces';
import { EntityLink } from '../entities/entity-link';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';
import { FieldError } from '../ui/field';
import { FaceReview } from './face-review';

const PERCENT = 100;

export function AssetFaces({ asset }: { asset: Pick<AssetSummary, 'name' | 'readableId'> }) {
  const analysis = useQuery(assetFacesQueryOptions(asset.readableId));
  const analyze = useAnalyzeAsset();
  const annotate = useAnnotateFace();
  const [selected, setSelected] = useState<string | null>(null);
  const result = analysis.data;
  const selectedFace = result?.faces.find((face) => face.readableId === selected);
  const pending = analyze.isPending || annotate.isPending;
  const visible = result?.faces.filter((face) => face.decision !== 'dismissed') ?? [];
  const dismissed = result?.faces.filter((face) => face.decision === 'dismissed') ?? [];

  return (
    <div className="grid min-w-0 gap-5">
      <div className="flex justify-center rounded-lg bg-background">
        <div className="relative max-w-full">
          <img
            src={assetContentUrl(asset.readableId)}
            alt={asset.name}
            className="block max-h-[32rem] max-w-full rounded-lg object-contain"
          />
          {visible.map((face) => (
            <button
              key={face.readableId}
              type="button"
              aria-label={`Review face: ${face.entity?.name ?? 'Unknown person'}`}
              aria-pressed={selected === face.readableId}
              className="absolute rounded-sm border-2 border-white shadow-[0_0_0_1px_#0008] outline-none focus-visible:ring-3 focus-visible:ring-ring aria-pressed:ring-3 aria-pressed:ring-ring"
              style={{
                left: `${face.box[0] * PERCENT}%`,
                top: `${face.box[1] * PERCENT}%`,
                width: `${face.box[2] * PERCENT}%`,
                height: `${face.box[3] * PERCENT}%`,
              }}
              onClick={() => setSelected(face.readableId)}
            >
              <span className="absolute top-full left-0 max-w-40 truncate rounded-b-sm bg-background px-1.5 py-0.5 text-foreground text-xs shadow-sm">
                {face.entity?.name ?? 'Unknown'}
              </span>
            </button>
          ))}
        </div>
      </div>
      <section className="grid gap-4" aria-label="People in this image">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold text-lg">People in this image</h2>
          {result?.state !== 'unsupported' && (
            <Button
              variant="outline"
              size="sm"
              disabled={pending || result?.state === 'processing'}
              onClick={() => analyze.mutate(asset.readableId)}
            >
              {analyze.isPending || result?.state === 'processing'
                ? 'Analyzing…'
                : result?.state === 'ready'
                  ? 'Find faces again'
                  : 'Analyze image'}
            </Button>
          )}
        </div>
        {(analysis.error || analyze.error) && (
          <FieldError>{(analysis.error ?? analyze.error)?.message}</FieldError>
        )}
        <FacesStatus pending={analysis.isPending} result={result} faceCount={visible.length} />
        <FaceAssignments
          faces={visible}
          assetReadableId={asset.readableId}
          onSelect={setSelected}
        />
        {dismissed.length > 0 && (
          <details>
            <summary className="cursor-pointer text-muted-foreground text-sm">
              Dismissed detections ({dismissed.length})
            </summary>
            <div className="mt-2 flex flex-wrap gap-2">
              {dismissed.map((face) => (
                <Button
                  key={face.readableId}
                  variant="outline"
                  onClick={() => setSelected(face.readableId)}
                >
                  <img
                    src={faceCropUrl({
                      assetReadableId: asset.readableId,
                      faceReadableId: face.readableId,
                    })}
                    alt=""
                    className="size-6 rounded object-cover"
                  />
                  Review dismissed face
                </Button>
              ))}
            </div>
          </details>
        )}
        <Dialog
          open={Boolean(selectedFace)}
          onOpenChange={(open) => {
            if (!open) {
              setSelected(null);
            }
          }}
        >
          {selectedFace && (
            <DialogContent>
              <DialogTitle>Review face</DialogTitle>
              {annotate.error && <FieldError>{annotate.error.message}</FieldError>}
              <FaceReview
                key={selectedFace.readableId}
                assetReadableId={asset.readableId}
                face={selectedFace}
                pending={pending}
                onDone={() => setSelected(null)}
                onChange={(body) =>
                  annotate.mutate({
                    assetReadableId: asset.readableId,
                    faceReadableId: selectedFace.readableId,
                    body,
                  })
                }
              />
            </DialogContent>
          )}
        </Dialog>
      </section>
    </div>
  );
}

function FaceAssignments({
  faces,
  assetReadableId,
  onSelect,
}: {
  faces: Face[];
  assetReadableId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <ul className="grid list-none gap-3 p-0 sm:grid-cols-2">
      {faces.map((face) => (
        <li key={face.readableId} className="flex items-center gap-3 rounded-lg bg-background p-3">
          <button
            type="button"
            className="shrink-0 rounded-full focus-visible:ring-3 focus-visible:ring-ring"
            aria-label={`Review ${face.entity?.name ?? 'unknown person'}`}
            onClick={() => onSelect(face.readableId)}
          >
            <img
              src={faceCropUrl({
                assetReadableId: assetReadableId,
                faceReadableId: face.readableId,
              })}
              alt=""
              className="size-12 rounded-full object-cover"
            />
          </button>
          <div className="grid min-w-0 gap-1">
            {face.entity ? (
              <EntityLink entity={face.entity} presentation="inline" />
            ) : (
              <span className="font-medium text-sm">Unknown person</span>
            )}
            <Badge variant="secondary" className="w-fit">
              {face.decision === 'automatic'
                ? 'Automatic'
                : face.decision === 'unknown'
                  ? 'Unidentified'
                  : 'Confirmed'}
            </Badge>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => onSelect(face.readableId)}
          >
            Review
          </Button>
        </li>
      ))}
    </ul>
  );
}

function FacesStatus({
  pending,
  result,
  faceCount,
}: {
  pending: boolean;
  result: AssetFacesData | undefined;
  faceCount: number;
}) {
  return (
    <>
      {pending && <p className="text-muted-foreground text-sm">Loading faces…</p>}
      {result?.error && (
        <p role="status" className="text-muted-foreground text-sm">
          {result.error}
        </p>
      )}
      {result?.outdated && (
        <p className="text-muted-foreground text-sm">
          A newer face model is available. Analyze this image again to update automatic matches.
        </p>
      )}
      {result?.state === 'processing' && (
        <p role="status" className="text-muted-foreground text-sm">
          Analyzing faces…
        </p>
      )}
      {result?.state === 'not_processed' && (
        <p className="text-muted-foreground text-sm">
          This image is saved and has not been analyzed yet.
        </p>
      )}
      {result?.state === 'unsupported' && (
        <p className="text-muted-foreground text-sm">
          Face recognition supports JPEG, PNG, and WebP images. This asset is saved.
        </p>
      )}
      {result?.state === 'ready' && faceCount === 0 && (
        <p className="text-muted-foreground text-sm">No faces found.</p>
      )}
    </>
  );
}
