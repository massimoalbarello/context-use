import { Button } from '@repo/ui/button';
export function SyncQueryState({
  query,
}: {
  query: { isPending: boolean; isError: boolean; refetch(): Promise<unknown> };
}) {
  if (query.isPending) {
    return (
      <p role="status" className="text-muted-foreground">
        Loading syncs…
      </p>
    );
  }
  if (query.isError) {
    return (
      <div role="alert" className="grid justify-items-start gap-3">
        <p>Could not load syncs.</p>
        <Button
          variant="outline"
          onClick={() => {
            void query.refetch();
          }}
        >
          Try again
        </Button>
      </div>
    );
  }
  return null;
}
