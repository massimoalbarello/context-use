import { Button } from '@repo/ui/button';
import type { UseQueryResult } from '@tanstack/react-query';
import { Badge } from '../ui/badge';
import { PublicBadge } from './publication-appearance';

export function PublicationStatus({
  query,
  showPublic = false,
}: {
  query: UseQueryResult<{ publishedAt: string | null }>;
  showPublic?: boolean;
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
  if (query.data.publishedAt !== null) {
    return showPublic ? <PublicBadge /> : null;
  }
  return <Badge variant="secondary">Private</Badge>;
}
