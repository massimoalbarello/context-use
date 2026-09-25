import { useSuspenseInfiniteQuery, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { FaceModelHealth, FaceProcessingQueue } from '../components/faces/face-processing';
import { FaceSettingsForm } from '../components/faces/face-settings';
import { InfiniteScrollTrigger } from '../components/knowledge/infinite-scroll-trigger';
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

export const Route = createFileRoute('/app/settings/faces')({
  validateSearch: (search: Record<string, unknown>): { filter?: FaceQueueFilter } => ({
    filter:
      search.filter === 'failed' ||
      search.filter === 'ready' ||
      search.filter === 'unsupported' ||
      search.filter === 'all'
        ? search.filter
        : 'pending',
  }),
  loaderDeps: ({ search }) => ({ filter: search.filter }),
  loader: ({ context, deps }) =>
    Promise.all([
      context.queryClient.ensureQueryData(faceSettingsQueryOptions),
      context.queryClient.ensureInfiniteQueryData(faceProcessingQueryOptions(deps)),
    ]),
  component: FaceSettingsRoute,
});

function FaceSettingsRoute() {
  const { data } = useSuspenseQuery(faceSettingsQueryOptions);
  const { filter = 'pending' } = Route.useSearch();
  const navigate = Route.useNavigate();
  const processing = useSuspenseInfiniteQuery(faceProcessingQueryOptions({ filter }));
  const latest = processing.data.pages[0]!;
  const items = [
    ...new Map(
      processing.data.pages
        .flatMap((page) => page.items)
        .map((item) => [item.asset.readableId, item]),
    ).values(),
  ];
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
          model={latest.model}
          pending={check.isPending}
          error={check.error}
          onCheck={() => check.mutate(undefined)}
        />
        <FaceProcessingQueue
          data={{ counts: latest.counts, items }}
          filter={filter}
          pending={retry.isPending}
          retrying={analyze.isPending ? analyze.variables : null}
          error={
            retry.error ??
            analyze.error ??
            (processing.isFetchNextPageError ? null : processing.error)
          }
          onFilter={(value) => void navigate({ search: { filter: value } })}
          onRetry={(id) => analyze.mutate(id)}
          onRetryFailed={() => retry.mutate(undefined)}
        >
          <InfiniteScrollTrigger
            hasNextPage={processing.hasNextPage}
            isFetchingNextPage={processing.isFetchingNextPage}
            error={processing.isFetchNextPageError ? processing.error : null}
            loadMore={() => processing.fetchNextPage({ cancelRefetch: false })}
            idleContent={null}
          />
        </FaceProcessingQueue>
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
