import { Button } from '@repo/ui/button';
import { useQuery } from '@tanstack/react-query';
import type { usePublicationApproval } from '../../lib/hooks/use-publication-approval';
import { type KnowledgePageDiff, pageDiffQueryOptions } from '../../queries/pages';
import { PublicationReviewDialog } from '../publications/publication-review-dialog';
import { RevisionDiff } from './revision-diff';

export function PagePublicationReview({
  approval,
}: {
  approval: ReturnType<typeof usePublicationApproval>;
}) {
  const preparation = approval.ready?.preparation;
  const publishing = approval.request?.action === 'publish';
  const selected = preparation?.pageRevision?.revisionNumber;
  const published = preparation?.pageRevision?.publishedRevisionNumber;
  const comparison = useQuery({
    ...pageDiffQueryOptions({
      readableId: preparation?.resource.readableId ?? '',
      from: published ?? 0,
      to: selected ?? 0,
    }),
    enabled: publishing && selected != null,
  });
  const diff = comparison.data;
  const reviewed =
    comparison.isSuccess && !!diff && diff.from === (published ?? 0) && diff.to === selected;
  return (
    <PublicationReviewDialog
      approval={approval}
      className="max-w-3xl"
      confirmDisabled={publishing && !reviewed}
    >
      {publishing ? (
        <>
          <p className="text-sm">
            Anyone with the link can read this page. Future edits stay private until you publish
            them.
          </p>
          <PagePublicationComparison
            error={comparison.error}
            diff={reviewed ? diff : undefined}
            onRetry={() => void comparison.refetch()}
          />
        </>
      ) : (
        <p className="text-sm">
          {published == null ? 'This page' : `Public revision ${published}`} will stop being
          available at this page’s public URL and in public entity page indices. Linked resources
          keep their own publication state.
        </p>
      )}
    </PublicationReviewDialog>
  );
}

function PagePublicationComparison({
  error,
  diff,
  onRetry,
}: {
  error: Error | null;
  diff: KnowledgePageDiff | undefined;
  onRetry: () => void;
}) {
  if (error) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-destructive text-sm" role="alert">
          {error.message}
        </p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Retry changes
        </Button>
      </div>
    );
  }
  return diff ? (
    <RevisionDiff diff={diff} />
  ) : (
    <p className="text-muted-foreground text-sm" role="status">
      Loading changes…
    </p>
  );
}
