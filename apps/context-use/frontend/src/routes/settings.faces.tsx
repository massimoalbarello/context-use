import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { FaceModelHealth, FaceProcessingQueue } from '../components/faces/face-processing';
import { FaceSettingsForm } from '../components/faces/face-settings';
import {
  useAnalyzeAsset,
  useCheckFaceModel,
  useRetryFailedImages,
  useSaveFaceThreshold,
} from '../lib/hooks/use-faces';
import {
  type FaceQueueFilter,
  faceProcessingQueryOptions,
  faceSettingsQueryOptions,
} from '../queries/faces';

export const Route = createFileRoute('/settings/faces')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { filter?: FaceQueueFilter; offset?: number } => ({
    filter:
      search.filter === 'failed' ||
      search.filter === 'ready' ||
      search.filter === 'unsupported' ||
      search.filter === 'all'
        ? search.filter
        : 'pending',
    offset:
      typeof search.offset === 'number' && Number.isSafeInteger(search.offset) && search.offset > 0
        ? search.offset
        : 0,
  }),
  loaderDeps: ({ search }) => ({ filter: search.filter, offset: search.offset }),
  loader: ({ context, deps }) =>
    Promise.all([
      context.queryClient.ensureQueryData(faceSettingsQueryOptions),
      context.queryClient.ensureQueryData(faceProcessingQueryOptions(deps)),
    ]),
  component: FaceSettingsRoute,
});

function FaceSettingsRoute() {
  const { data } = useSuspenseQuery(faceSettingsQueryOptions);
  const { filter = 'pending', offset = 0 } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data: processing, error: processingError } = useSuspenseQuery(
    faceProcessingQueryOptions({ filter, offset }),
  );
  const save = useSaveFaceThreshold();
  const retry = useRetryFailedImages();
  const analyze = useAnalyzeAsset();
  const check = useCheckFaceModel();
  return (
    <div className="mx-auto grid w-full max-w-4xl gap-10 px-5 py-10 md:px-10 md:py-12">
      <header className="grid gap-3">
        <h1 className="font-semibold text-3xl tracking-tight">Face recognition</h1>
        <p className="max-w-2xl text-muted-foreground">
          Find people in your images using their entity portraits. Images are analyzed on this
          Context Use instance.
        </p>
      </header>
      <div className="grid max-w-2xl gap-10">
        <FaceModelHealth
          model={processing.model}
          pending={check.isPending}
          error={check.error}
          onCheck={() => check.mutate(undefined)}
        />
        <FaceProcessingQueue
          data={processing}
          filter={filter}
          offset={offset}
          pending={retry.isPending}
          retrying={analyze.isPending ? analyze.variables : null}
          error={retry.error ?? analyze.error ?? processingError}
          onFilter={(value) => void navigate({ search: { filter: value, offset: 0 } })}
          onPage={(value) => void navigate({ search: { filter, offset: value } })}
          onRetry={(id) => analyze.mutate(id)}
          onRetryFailed={() => retry.mutate(undefined)}
        />
        <FaceSettingsForm
          key={`${data.model.analysisVersion}/${data.threshold}`}
          settings={data}
          pending={save.isPending}
          error={save.error}
          onSave={(input) => save.mutate(input)}
        />
        {save.isSuccess && (
          <p role="status" className="text-muted-foreground text-sm">
            {save.variables.rematch
              ? 'Threshold saved and automatic matches updated.'
              : 'Threshold saved.'}
          </p>
        )}
      </div>
    </div>
  );
}
