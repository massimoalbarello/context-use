import { Button } from '@repo/ui/button';
import { useQuery } from '@tanstack/react-query';
import { pageDiffQueryOptions } from '../../queries/pages';
import { RevisionDiff } from './revision-diff';

export function KnowledgePageRevisionComparison({
  readableId,
  revisionNumber,
}: {
  readableId: string;
  revisionNumber: number;
}) {
  const comparison = useQuery(
    pageDiffQueryOptions({
      readableId,
      from: revisionNumber - 1,
      to: revisionNumber,
    }),
  );
  if (comparison.error) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-destructive text-sm" role="alert">
          {comparison.error.message}
        </p>
        <Button variant="outline" size="sm" onClick={() => void comparison.refetch()}>
          Retry
        </Button>
      </div>
    );
  }
  if (!comparison.data) {
    return (
      <p className="text-muted-foreground text-sm" role="status">
        Loading changes…
      </p>
    );
  }
  return <RevisionDiff diff={comparison.data} />;
}
