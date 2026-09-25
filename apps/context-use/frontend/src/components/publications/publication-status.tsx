import { Button } from '@repo/ui/button';
import type { UseQueryResult } from '@tanstack/react-query';
import { Badge } from '../ui/badge';

export function PublicationStatus({
  query,
}: {
  query: UseQueryResult<{ publishedAt: string | null }>;
}) {
  if (query.isError) {
    return (
      <Button variant="outline" onClick={() => void query.refetch()}>
        Retry publication status
      </Button>
    );
  }
  if (!query.data) {
    return (
      <span role="status" className="text-muted-foreground text-sm">
        Loading publication status…
      </span>
    );
  }
  const isPublic = query.data.publishedAt !== null;
  return (
    <Badge variant={isPublic ? 'default' : 'secondary'}>{isPublic ? 'Public' : 'Private'}</Badge>
  );
}
