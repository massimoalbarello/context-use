import { Button } from '@repo/ui/button';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { Page, PagesClient, SearchInput } from './client';
import { PageDetail } from './page-detail';
import { PageEditor } from './page-editor';
import { PageSearch } from './page-search';
import { resourceQueryKey, searchQueryKey } from './queries';
import { AssetPreview, EntityPreview } from './resource-preview';
import { useContentSize, WidgetLoading } from './widget-loading';

export function PagesApp({
  client,
  initialAddress,
  initialSearch,
  initialNotice = '',
}: {
  client: PagesClient;
  initialAddress?: string;
  initialSearch?: SearchInput;
  initialNotice?: string;
}) {
  const [path, setPath] = useState<string[]>(initialAddress ? [initialAddress] : []);
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState(initialSearch?.query ?? '');
  const [notice, setNotice] = useState(initialNotice);
  const queryClient = useQueryClient();
  const address = path.at(-1);
  const open = (next: string) => {
    setNotice('');
    setEditing(false);
    setPath((prev) => (prev.at(-1) === next ? prev : [...prev, next]));
  };
  const saved = (page: Page) => {
    queryClient.setQueryData(resourceQueryKey(page.address), { kind: 'page', value: page });
    void queryClient.invalidateQueries({ queryKey: searchQueryKey });
    setEditing(false);
    setNotice('Page saved.');
  };
  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3 border-border border-b pb-4">
        <span className="font-semibold text-sm">context-use</span>
        {!!address && !editing && (
          <div className="flex gap-2">
            {path.length > 1 && (
              <Button
                variant="outline"
                onClick={() => {
                  setPath(path.slice(0, -1));
                  setNotice('');
                }}
              >
                Back
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => {
                setPath([]);
                setNotice('');
              }}
            >
              Search
            </Button>
          </div>
        )}
      </header>
      {notice && (
        <p role="status" className="mb-4 text-muted-foreground text-sm">
          {notice}
        </p>
      )}
      {!address ? (
        <PageSearch
          client={client}
          onPage={open}
          query={query}
          setQuery={setQuery}
          filters={initialSearch}
        />
      ) : (
        <ResourceDetail
          key={address}
          address={address}
          client={client}
          editing={editing}
          onOpen={open}
          onEdit={() => {
            setEditing(true);
            setNotice('');
          }}
          onCancel={() => setEditing(false)}
          onSaved={saved}
        />
      )}
    </main>
  );
}

function ResourceDetail({
  address,
  client,
  editing,
  onOpen,
  onEdit,
  onCancel,
  onSaved,
}: {
  address: string;
  client: PagesClient;
  editing: boolean;
  onOpen: (address: string) => void;
  onEdit: () => void;
  onCancel: () => void;
  onSaved: (page: Page) => void;
}) {
  const canonical = address.split('#')[0]!;
  const detail = useQuery({
    queryKey: resourceQueryKey(canonical),
    queryFn: () => client.resource(canonical),
  });
  useContentSize({ client, ready: !detail.isPending });
  if (!detail.data) {
    return detail.error ? (
      <div role="alert">
        <p>{detail.error.message}</p>
        <Button variant="outline" onClick={() => void detail.refetch()}>
          Try again
        </Button>
      </div>
    ) : (
      <WidgetLoading label="Loading preview" />
    );
  }
  switch (detail.data.kind) {
    case 'entity':
      return <EntityPreview entity={detail.data.value} client={client} onOpen={onOpen} />;
    case 'asset':
      return <AssetPreview asset={detail.data.value} client={client} />;
    case 'page':
      return editing ? (
        <PageEditor
          page={detail.data.value}
          client={client}
          onSaved={onSaved}
          onCancel={onCancel}
        />
      ) : (
        <PageDetail
          page={detail.data.value}
          client={client}
          address={address}
          onOpen={onOpen}
          onEdit={onEdit}
        />
      );
  }
}
