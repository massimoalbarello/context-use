import { Button } from '@repo/ui/button';
import type { FaceProcessing, FaceQueueFilter } from '../../queries/faces';
import { AssetLink } from '../assets/asset-link';
import { FieldError } from '../ui/field';

const modelLabels: Record<FaceProcessing['model']['state'], string> = {
  ready: 'Ready',
  checking: 'Checking model…',
  not_downloaded: 'Not downloaded',
  unchecked: 'Not checked yet',
  unavailable: 'Unavailable',
};
const stateLabels: Record<FaceProcessing['items'][number]['state'], string> = {
  queued: 'Queued',
  processing: 'Processing…',
  ready: 'Processed',
  failed: 'Failed',
  unsupported: 'Unsupported format',
};
const filters: Array<{ value: FaceQueueFilter; label: string }> = [
  { value: 'pending', label: 'Pending' },
  { value: 'failed', label: 'Failed' },
  { value: 'ready', label: 'Processed' },
  { value: 'unsupported', label: 'Unsupported' },
  { value: 'all', label: 'All images' },
];

export function FaceModelHealth({
  model,
  pending,
  error,
  onCheck,
}: {
  model: FaceProcessing['model'];
  pending: boolean;
  error: Error | null;
  onCheck: () => void;
}) {
  return (
    <section className="grid gap-3" aria-labelledby="face-model-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid gap-1">
          <h2 id="face-model-heading" className="font-semibold text-lg">
            Model
          </h2>
          <p className="text-muted-foreground text-sm">
            {model.name} · <span role="status">{modelLabels[model.state]}</span>
          </p>
        </div>
        <Button
          variant="outline"
          disabled={pending || model.state === 'checking'}
          onClick={onCheck}
        >
          {pending || model.state === 'checking'
            ? 'Checking…'
            : model.downloaded
              ? 'Check model'
              : 'Download & check'}
        </Button>
      </div>
      <p className="text-muted-foreground text-sm">
        {model.downloaded
          ? 'Model files downloaded.'
          : 'Model files have not been verified on this instance.'}{' '}
        {model.state === 'ready'
          ? 'The engine loaded them successfully.'
          : 'Processing waits until the model is usable.'}
      </p>
      {model.error && (
        <p role="status" className="text-sm">
          {model.error}
        </p>
      )}
      {error && <FieldError>{error.message}</FieldError>}
    </section>
  );
}

export function FaceProcessingQueue({
  data,
  filter,
  offset,
  pending,
  retrying,
  error,
  onFilter,
  onPage,
  onRetry,
  onRetryFailed,
}: {
  data: FaceProcessing;
  filter: FaceQueueFilter;
  offset: number;
  pending: boolean;
  retrying: string | null;
  error: Error | null;
  onFilter: (value: FaceQueueFilter) => void;
  onPage: (offset: number) => void;
  onRetry: (id: string) => void;
  onRetryFailed: () => void;
}) {
  return (
    <section className="grid gap-4" aria-labelledby="face-queue-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h2 id="face-queue-heading" className="font-semibold text-lg">
            Image processing
          </h2>
          <p role="status" className="text-muted-foreground text-sm">
            {data.counts.queued} pending · {data.counts.failed} failed · {data.counts.ready}{' '}
            processed
          </p>
        </div>
        {data.counts.failed > 0 && (
          <Button variant="outline" disabled={pending} onClick={onRetryFailed}>
            {pending ? 'Queuing…' : 'Retry failed'}
          </Button>
        )}
      </div>
      <p className="text-muted-foreground text-sm">
        Images process automatically, one at a time. You can leave this page.
      </p>
      <fieldset className="flex flex-wrap gap-1" aria-label="Filter images">
        {filters.map((item) => (
          <Button
            key={item.value}
            variant={filter === item.value ? 'secondary' : 'ghost'}
            size="sm"
            aria-pressed={filter === item.value}
            onClick={() => onFilter(item.value)}
          >
            {item.label}
          </Button>
        ))}
      </fieldset>
      {error && <FieldError>{error.message}</FieldError>}
      {data.items.length === 0 ? (
        <p className="py-3 text-muted-foreground text-sm">
          {filter === 'pending'
            ? 'No images waiting to be processed.'
            : filter === 'failed'
              ? 'No failed images.'
              : 'No images in this view.'}
        </p>
      ) : (
        <ul className="grid max-h-80 gap-3 overflow-y-auto" aria-label="Image processing queue">
          {data.items.map((item) => (
            <li key={item.asset.readableId} className="grid gap-1">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <AssetLink asset={item.asset} presentation="card" />
                </div>
                <span className="shrink-0 text-muted-foreground text-xs">
                  {stateLabels[item.state]}
                </span>
                {item.state === 'failed' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={retrying !== null}
                    aria-label={`Retry ${item.asset.name}`}
                    onClick={() => onRetry(item.asset.readableId)}
                  >
                    {retrying === item.asset.readableId ? 'Queuing…' : 'Retry'}
                  </Button>
                )}
              </div>
              {item.error && <p className="px-3 text-muted-foreground text-sm">{item.error}</p>}
            </li>
          ))}
        </ul>
      )}
      {(offset > 0 || data.nextOffset !== null) && (
        <div className="flex gap-2">
          <Button variant="ghost" disabled={offset === 0} onClick={() => onPage(0)}>
            First page
          </Button>
          <Button
            variant="outline"
            disabled={data.nextOffset === null}
            onClick={() => {
              if (data.nextOffset !== null) {
                onPage(data.nextOffset);
              }
            }}
          >
            More images
          </Button>
        </div>
      )}
    </section>
  );
}
