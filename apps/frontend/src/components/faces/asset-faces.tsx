import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { assetContentUrl } from '../../lib/asset-presentation';
import { cn } from '../../lib/class-names';
import { useAnalyzeAsset, useAnnotateFace } from '../../lib/hooks/use-faces';
import type { AssetSummary } from '../../queries/assets';
import { type AssetFaces as AssetFacesData, assetFacesQueryOptions } from '../../queries/faces';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';
import { FieldError } from '../ui/field';
import { FaceReview } from './face-review';

const PERCENT = 100;

export function AssetFaces({
  asset,
  children,
}: {
  asset: Pick<AssetSummary, 'name' | 'readableId'>;
  children: (content: { preview: ReactNode; processAction: ReactNode }) => ReactNode;
}) {
  const analysis = useQuery(assetFacesQueryOptions(asset.readableId));
  const analyze = useAnalyzeAsset();
  const annotate = useAnnotateFace();
  const [selected, setSelected] = useState<string | null>(null);
  const [showDismissed, setShowDismissed] = useState(false);
  const result = analysis.data;
  const selectedFace = result?.faces.find((face) => face.readableId === selected);
  const processing = analyze.isPending || result?.state === 'processing';
  const pending = processing || annotate.isPending;
  const visible =
    result?.faces.filter((face) => showDismissed || face.decision !== 'dismissed') ?? [];
  const dismissed = result?.faces.filter((face) => face.decision === 'dismissed') ?? [];

  const preview = (
    <section className="grid min-w-0 gap-5" aria-label="Detected faces">
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
              aria-label={`Review face: ${face.decision === 'dismissed' ? 'Not a face' : (face.entity?.name ?? 'Unknown')}`}
              aria-haspopup="dialog"
              aria-pressed={selected === face.readableId}
              className={cn(
                'absolute rounded-sm border-2 border-white shadow-[0_0_0_1px_#0008] outline-none focus-visible:ring-3 focus-visible:ring-ring aria-pressed:ring-3 aria-pressed:ring-ring',
                face.decision === 'dismissed' && 'border-dashed',
              )}
              style={{
                left: `${face.box[0] * PERCENT}%`,
                top: `${face.box[1] * PERCENT}%`,
                width: `${face.box[2] * PERCENT}%`,
                height: `${face.box[3] * PERCENT}%`,
              }}
              onClick={() => setSelected(face.readableId)}
            >
              <span className="absolute top-full left-0 max-w-40 truncate rounded-b-sm bg-background px-1.5 py-0.5 text-foreground text-xs shadow-sm">
                {face.decision === 'dismissed' ? 'Not a face' : (face.entity?.name ?? 'Unknown')}
              </span>
            </button>
          ))}
        </div>
      </div>
      {(analysis.error || analyze.error) && (
        <FieldError>{(analysis.error ?? analyze.error)?.message}</FieldError>
      )}
      <FacesStatus pending={analysis.isPending} result={result} />
      {dismissed.length > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="w-fit"
          aria-expanded={showDismissed}
          onClick={() => setShowDismissed((show) => !show)}
        >
          {showDismissed ? 'Hide' : 'Show'} dismissed faces ({dismissed.length})
        </Button>
      )}
    </section>
  );
  const processAction = result?.state !== 'unsupported' && (
    <Button variant="outline" disabled={pending} onClick={() => analyze.mutate(asset.readableId)}>
      {processing ? 'Processing…' : 'Process image'}
    </Button>
  );
  return (
    <>
      {children({ preview, processAction })}
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
            <div className="flex items-center justify-between gap-4">
              <DialogTitle>Review face</DialogTitle>
              <Button variant="ghost" onClick={() => setSelected(null)}>
                Done
              </Button>
            </div>
            {annotate.error && <FieldError>{annotate.error.message}</FieldError>}
            <FaceReview
              key={selectedFace.readableId}
              assetReadableId={asset.readableId}
              face={selectedFace}
              pending={pending}
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
    </>
  );
}

function FacesStatus({
  pending,
  result,
}: {
  pending: boolean;
  result: AssetFacesData | undefined;
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
          A newer face model is available. Process this image again to update automatic matches.
        </p>
      )}
      {result?.state === 'processing' && (
        <p role="status" className="text-muted-foreground text-sm">
          Processing image…
        </p>
      )}
      {result?.state === 'not_processed' && (
        <p className="text-muted-foreground text-sm">
          This image is saved and has not been processed yet.
        </p>
      )}
      {result?.state === 'unsupported' && (
        <p className="text-muted-foreground text-sm">
          Face recognition supports JPEG, PNG, and WebP images. This asset is saved.
        </p>
      )}
      {result?.state === 'ready' && result.faces.length === 0 && (
        <p className="text-muted-foreground text-sm">No faces found.</p>
      )}
    </>
  );
}
