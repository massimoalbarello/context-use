import { Button } from '@repo/ui/button';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ResourceArchiveAction } from '../components/knowledge/resource-archive-action';
import { ResourceDetailActions } from '../components/knowledge/resource-detail-actions';
import { type Page, type PagesClient, PageToolError } from './client';
import { PageMarkdown } from './page-markdown';
import { pageQueryKey, pagesQueryKey } from './queries';

export function PageDetail({
  client,
  address,
  onPage,
  onEdit,
  onArchived,
}: {
  client: PagesClient;
  address: string;
  onPage: (address: string) => void;
  onEdit: (page: Page) => void;
  onArchived: () => void;
}) {
  const [linkError, setLinkError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const canonicalAddress = address.split('#')[0]!;
  const detail = useQuery({
    queryKey: pageQueryKey(canonicalAddress),
    queryFn: () => client.read(canonicalAddress),
    retry: false,
  });
  const archive = useMutation({
    mutationFn: () => client.archive(canonicalAddress),
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: pageQueryKey(canonicalAddress) });
      onArchived();
      await queryClient.invalidateQueries({ queryKey: pagesQueryKey });
    },
  });
  if (detail.isPending) {
    return <p role="status">Loading page…</p>;
  }
  if (detail.error) {
    return (
      <div role="alert" className="grid gap-3">
        <p>{detail.error.message}</p>
        <Button variant="outline" onClick={() => void detail.refetch()}>
          Try again
        </Button>
      </div>
    );
  }
  const page = detail.data;
  return (
    <section className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-muted-foreground text-sm">
          Revision {page.revisionNumber}
          {page.publication.isPublic ? ' · Public' : ' · Private'}
          {page.temporalCoverage ? ` · ${page.temporalCoverage}` : ''}
        </span>
        <div className="flex gap-2">
          <ResourceDetailActions
            mode="view"
            resource="page"
            editDisabled={archive.isPending || detail.isFetching}
            onEdit={() => onEdit(page)}
          >
            <ResourceArchiveAction
              resource="page"
              blocked={false}
              pending={archive.isPending}
              onBlocked={() => {}}
              onConfirm={() => archive.mutate()}
            />
          </ResourceDetailActions>
        </div>
      </div>
      {archive.error && (
        <div role="alert" className="grid gap-2 text-sm">
          <p>{archive.error.message}</p>
          {archive.error instanceof PageToolError &&
            archive.error.blockers.map((blocker) => (
              <Button key={blocker.address} variant="link" onClick={() => onPage(blocker.address)}>
                {blocker.title}
              </Button>
            ))}
        </div>
      )}
      {linkError && <p role="alert">{linkError}</p>}
      <PageMarkdown
        fragment={address.split('#')[1]}
        markdown={page.markdown}
        onPage={onPage}
        onExternal={(url) => {
          void client.app
            .openLink({ url })
            .catch(() => setLinkError('Could not open this link. Try again.'));
        }}
      />
    </section>
  );
}
