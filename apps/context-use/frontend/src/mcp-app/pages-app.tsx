import { Button } from '@repo/ui/button';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { Page, PagesClient } from './client';
import { PageDetail } from './page-detail';
import { PageEditor } from './page-editor';
import { PageSearch } from './page-search';
import { pageQueryKey, pagesQueryKey } from './queries';

type View = { kind: 'read' | 'edit'; address: string };

export function PagesApp({
  client,
  initial,
  initialNotice = '',
}: {
  client: PagesClient;
  initial: Page | null;
  initialNotice?: string;
}) {
  const [view, setView] = useState<View | null>(
    initial ? { kind: 'read', address: initial.address } : null,
  );
  const [notice, setNotice] = useState(initialNotice);
  const queryClient = useQueryClient();
  const navigate = (next: View | null) => {
    setView(next);
    setNotice('');
  };
  const address = view?.address.split('#')[0];
  const detail = useQuery({
    queryKey: pageQueryKey(address),
    queryFn: () => client.read(address!),
    enabled: !!address,
  });
  const saved = (page: Page) => {
    queryClient.setQueryData(pageQueryKey(page.address), page);
    void queryClient.invalidateQueries({ queryKey: pagesQueryKey });
    setView({ kind: 'read', address: page.address });
    setNotice('Page saved.');
  };
  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3 border-border border-b pb-4">
        <span className="font-semibold text-sm">
          context-use <span className="ml-2 font-normal text-muted-foreground">Pages</span>
        </span>
        {view && (view.kind === 'read' || !detail.data) && (
          <Button variant="outline" onClick={() => navigate(null)}>
            Search pages
          </Button>
        )}
      </header>
      {notice && (
        <p role="status" className="mb-4 text-muted-foreground text-sm">
          {notice}
        </p>
      )}
      {!view ? (
        <PageSearch client={client} onPage={(address) => navigate({ kind: 'edit', address })} />
      ) : detail.data ? (
        view.kind === 'edit' ? (
          <PageEditor
            key={view.address}
            client={client}
            page={detail.data}
            onSaved={saved}
            onCancel={() => navigate({ ...view, kind: 'read' })}
          />
        ) : (
          <PageDetail
            key={view.address}
            client={client}
            page={detail.data}
            address={view.address}
            onPage={(address) => navigate({ kind: 'read', address })}
            onEdit={() => navigate({ ...view, kind: 'edit' })}
          />
        )
      ) : detail.error ? (
        <div role="alert">
          <p>{detail.error.message}</p>
          <Button variant="outline" onClick={() => void detail.refetch()}>
            Try again
          </Button>
        </div>
      ) : (
        <p role="status">Loading page…</p>
      )}
    </main>
  );
}
